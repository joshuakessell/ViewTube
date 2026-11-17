import { PS, type PlayerAdapter } from './player';

/**
 * The shared "what should be on screen" state. Both phones hold a copy and
 * each drives its own YouTube player to match it.
 *
 * Position is stored as "was at `position` seconds at time `at`", so a playing
 * video's current position can be computed at any moment without a stream of
 * updates.
 */
export interface Playback {
  videoId: string | null;
  playing: boolean;
  position: number;
  rate: number;
  /** Milliseconds, on the clock of whichever device sent this copy. */
  at: number;
  /** Bumped on every change; the higher revision wins. */
  rev: number;
  /** Who made the change; breaks ties between equal revisions. */
  by: string;
}

/** What the UI needs to know about this device's player. */
export interface PlayerView {
  hasPlayer: boolean;
  state: number;
  time: number;
  duration: number;
  /** The browser refused to start playback by script; the user has to tap the video once. */
  needsTap: boolean;
  error: string | null;
}

export interface SyncDeps {
  selfId: string;
  /** Milliseconds to add to this device's clock to get the other device's clock. */
  peerOffset(): number;
  /** Broadcast our copy of the state to the other device. */
  send(state: Playback): void;
  onChange(): void;
  now?: () => number;
  isHidden?: () => boolean;
}

type Stored = Playback & {
  /** True when `at` is on this device's clock, false when it is on the peer's. */
  local: boolean;
};

interface Sample {
  pos: number;
  wall: number;
  duration: number;
  started: boolean;
}

/** After commanding the player, ignore the events it emits in response for this long. */
const HOLD_MS = 1200;
const TICK_MS = 250;
/** Movement of the playhead that normal playback can't explain, in seconds, that counts as a scrub. */
const JUMP_S = 1;
/** How far a playing video may drift from the shared position before we pull it back. */
const DRIFT_S = 1.5;
const DRIFT_COOLDOWN_MS = 4000;
/** Scrubbing reports a brief pause; wait this long before treating a pause as deliberate. */
const PAUSE_DEBOUNCE_MS = 350;

const EMPTY: Stored = { videoId: null, playing: false, position: 0, rate: 1, at: 0, rev: 0, by: '', local: true };

const ERRORS: Record<number, string> = {
  2: "That link doesn't point to a valid video.",
  5: "This video can't be played in the embedded player.",
  100: 'This video is unavailable. It may be private or removed.',
  101: "The owner of this video doesn't allow it to play outside YouTube. Try a different one.",
  150: "The owner of this video doesn't allow it to play outside YouTube. Try a different one.",
  153: 'YouTube refused to load its player on this page.',
};

function isNewer(a: Pick<Playback, 'rev' | 'by'>, b: Pick<Playback, 'rev' | 'by'>): boolean {
  return a.rev > b.rev || (a.rev === b.rev && a.by > b.by);
}

const isActive = (state: number) => state === PS.PLAYING || state === PS.BUFFERING;
const isFresh = (state: number) => state === PS.UNSTARTED || state === PS.CUED;

export class PlaybackSync {
  private state: Stored = EMPTY;
  private player: PlayerAdapter | null = null;
  /** The video id currently loaded in this device's player. */
  private loadedId: string | null = null;
  /** Where the not-yet-started video was cued; the player reports 0 until it starts. */
  private cuePos = 0;
  private holdUntil = 0;
  private lastCatchUp = 0;
  private last: Sample | null = null;
  private needsTap = false;
  private error: string | null = null;
  private view: PlayerView = { hasPlayer: false, state: PS.UNSTARTED, time: 0, duration: 0, needsTap: false, error: null };
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: SyncDeps) {}

  // --- reading ---------------------------------------------------------------

  getPlayback(): Playback {
    return this.state;
  }

  getView(): PlayerView {
    return this.view;
  }

  /** Our copy of the state, with `at` on this device's clock, ready to send. */
  wire(): Playback {
    const { local, ...rest } = this.state;
    return local ? rest : { ...rest, at: rest.at - this.deps.peerOffset() };
  }

  /** Where the shared playhead is right now, in seconds. */
  expected(now = this.now()): number {
    const s = this.state;
    if (!s.playing) return s.position;
    const at = s.local ? s.at : s.at - this.deps.peerOffset();
    return Math.max(0, s.position + ((now - at) / 1000) * s.rate);
  }

  /** What to cue when the player is first created. */
  initialCue(): { videoId: string; start: number } | null {
    const { videoId } = this.state;
    return videoId ? { videoId, start: this.expected() } : null;
  }

  // --- things the user does through our own controls -----------------------------

  setVideo(videoId: string, start = 0): void {
    // Start paused: whoever taps play starts it for both, so the clock never
    // runs while nobody is actually watching yet.
    this.commit({ videoId, playing: false, position: start, rate: 1 }, true);
  }

  play(): void {
    if (!this.state.videoId) return;
    const p = this.player;
    let position = this.state.position;
    if (p && this.loadedId === this.state.videoId && !isFresh(p.getState())) {
      const duration = p.getDuration();
      const time = p.getTime();
      position = duration > 0 && time >= duration - 0.5 ? 0 : time; // at the end: replay
    }
    this.commit({ playing: true, position }, true);
  }

  pause(): void {
    if (!this.state.videoId) return;
    const p = this.player;
    // Use our own playhead only if it is really playing; a stalled or
    // not-yet-started player would drag the other person backwards.
    const mine = p && this.loadedId === this.state.videoId && p.getState() === PS.PLAYING;
    this.commit({ playing: false, position: mine ? p.getTime() : this.expected() }, true);
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  seek(seconds: number): void {
    if (!this.state.videoId) return;
    this.commit({ position: Math.max(0, seconds) }, true);
  }

  // --- changes from the other device ---------------------------------------------

  /**
   * Returns 'applied' if theirs was newer, 'stale' if ours is newer (the
   * caller should send ours back), or 'same'.
   */
  applyRemote(remote: Playback): 'applied' | 'stale' | 'same' {
    if (!isNewer(remote, this.state)) return isNewer(this.state, remote) ? 'stale' : 'same';
    this.state = { ...remote, local: false };
    this.last = null;
    clearTimeout(this.pauseTimer);
    this.reconcile();
    this.refresh(true);
    return 'applied';
  }

  isNewerThan(other: Pick<Playback, 'rev' | 'by'>): boolean {
    return isNewer(this.state, other);
  }

  // --- player lifecycle -------------------------------------------------------------

  attachPlayer(player: PlayerAdapter, loadedId: string, cuePos: number): void {
    this.detachPlayer();
    this.player = player;
    this.loadedId = loadedId;
    this.cuePos = cuePos;
    this.error = null;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.reconcile();
    this.refresh(true);
  }

  detachPlayer(): void {
    clearInterval(this.tickTimer);
    clearTimeout(this.settleTimer);
    clearTimeout(this.pauseTimer);
    this.player = null;
    this.loadedId = null;
    this.last = null;
    this.needsTap = false;
    this.holdUntil = 0;
    this.refresh(true);
  }

  /** Call when the page becomes visible again: the browser may have paused the video. */
  resync(): void {
    this.reconcile();
    this.refresh(true);
  }

  // --- events from the YouTube player ---------------------------------------------

  readonly onPlayerState = (ps: number): void => {
    const now = this.now();
    if (ps === PS.PLAYING) this.needsTap = false;
    if (ps !== PS.PAUSED) clearTimeout(this.pauseTimer);
    // Inside the hold window the event is (almost certainly) the echo of a
    // command we just gave; settle() double-checks once the window closes.
    if (now >= this.holdUntil) this.evaluate(ps, now);
    this.refresh();
  };

  readonly onPlayerRate = (rate: number): void => {
    if (this.now() < this.holdUntil || !this.state.videoId) return;
    if (Math.abs(rate - this.state.rate) > 0.01) this.commit({ rate }, false);
  };

  readonly onPlayerError = (code: number): void => {
    this.error = ERRORS[code] ?? `YouTube couldn't play this video (error ${code}).`;
    this.needsTap = false;
    this.refresh(true);
  };

  readonly onLoadFailed = (): void => {
    this.error = "Couldn't load the YouTube player. Check your connection and reload.";
    this.refresh(true);
  };

  // --- internals ----------------------------------------------------------------------

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private hidden(): boolean {
    if (this.deps.isHidden) return this.deps.isHidden();
    return typeof document !== 'undefined' && document.hidden;
  }

  private commit(patch: Partial<Pick<Playback, 'videoId' | 'playing' | 'position' | 'rate'>>, apply: boolean): void {
    const now = this.now();
    // Every change re-anchors the position at "now", so a rate change or a
    // play/pause never moves the playhead by itself.
    const position = Math.max(0, patch.position ?? this.expected(now));
    this.state = {
      ...this.state,
      ...patch,
      position,
      at: now,
      rev: this.state.rev + 1,
      by: this.deps.selfId,
      local: true,
    };
    this.last = null;
    clearTimeout(this.pauseTimer);
    this.deps.send(this.wire());
    if (apply) this.reconcile();
    this.refresh(true);
  }

  /** Start ignoring player events: we are about to cause some ourselves. */
  private hold(now: number): void {
    this.holdUntil = now + HOLD_MS;
    this.last = null;
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.settle(), HOLD_MS + 50);
  }

  /** Drive this device's player to match the shared state. */
  private reconcile(): void {
    const p = this.player;
    const s = this.state;
    if (!p || !s.videoId) return;
    const now = this.now();
    const target = this.expected(now);

    if (this.loadedId !== s.videoId) {
      this.loadedId = s.videoId;
      this.cuePos = target;
      this.error = null;
      this.needsTap = false;
      this.hold(now);
      if (s.playing) p.load(s.videoId, target);
      else p.cue(s.videoId, target);
      return;
    }
    if (this.error) return;

    const ps = p.getState();
    if (Math.abs(p.getRate() - s.rate) > 0.01) p.setRate(s.rate);

    if (!s.playing) {
      this.needsTap = false;
      if (isFresh(ps)) {
        // seekTo() on a video that has not started would start it, so re-cue instead.
        if (Math.abs(this.cuePos - s.position) > 0.3) {
          this.cuePos = s.position;
          this.hold(now);
          p.cue(s.videoId, s.position);
        }
        return;
      }
      if (isActive(ps)) {
        this.hold(now);
        p.pause();
      }
      if (Math.abs(p.getTime() - s.position) > 0.3) {
        this.hold(now);
        p.seek(s.position);
        if (ps === PS.ENDED) p.pause(); // seeking out of "ended" resumes playback
      }
      return;
    }

    const duration = p.getDuration();
    if (duration > 0 && target >= duration - 0.5) return; // the video is over; leave it on its end screen
    if (isFresh(ps)) {
      this.cuePos = target;
      this.hold(now);
      p.load(s.videoId, target);
      return;
    }
    if (Math.abs(p.getTime() - target) > (isActive(ps) ? DRIFT_S : 0.3)) {
      this.hold(now);
      p.seek(target);
    }
    if (!isActive(ps)) {
      this.hold(now);
      p.play();
    }
  }

  /** Runs once the hold window closes: did the player end up where we told it to go? */
  private settle(): void {
    const p = this.player;
    const s = this.state;
    if (!p || !s.videoId || this.loadedId !== s.videoId || this.error) return;
    const ps = p.getState();
    if (s.playing) {
      const duration = p.getDuration();
      const over = ps === PS.ENDED || (duration > 0 && this.expected() >= duration - 0.5);
      // We asked it to play and it didn't: the browser wants a real tap on the
      // video first (iOS does, for the first play). Ask instead of retrying.
      if (!isActive(ps) && !over) this.needsTap = true;
    } else if (isActive(ps)) {
      this.reconcile(); // a late event flipped it back to playing
    }
    this.refresh(true);
  }

  /** React to something the player did on its own, i.e. the user touched YouTube's controls. */
  private evaluate(ps: number, now: number): void {
    const p = this.player;
    const s = this.state;
    if (!p || !s.videoId || this.loadedId !== s.videoId) return;

    if (ps === PS.PLAYING) {
      const time = p.getTime();
      if (!s.playing) {
        this.commit({ playing: true, position: time }, false); // tapped play inside the YouTube frame
      } else if (this.jumped(time, p, now)) {
        this.commit({ position: time }, false); // scrubbed inside the YouTube frame
      } else if (Math.abs(time - this.expected(now)) > DRIFT_S) {
        this.catchUp(p, now); // started late or stalled: follow the other person
      }
      return;
    }

    if (ps === PS.PAUSED && s.playing) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = setTimeout(() => {
        const current = this.player;
        if (!current || !this.state.playing || this.hidden()) return; // backgrounding pauses video; that is not a user pause
        if (current.getState() !== PS.PAUSED || this.now() < this.holdUntil) return;
        this.commit({ playing: false, position: current.getTime() }, false);
      }, PAUSE_DEBOUNCE_MS);
    }
  }

  /** True if the playhead moved in a way playback alone can't explain. */
  private jumped(time: number, p: PlayerAdapter, now: number): boolean {
    const last = this.last;
    if (!last || !last.started) return false;
    if (Math.abs(last.duration - p.getDuration()) > 0.5) return false; // different media (e.g. an ad)
    const elapsed = Math.max(0, (now - last.wall) / 1000);
    const max = last.pos + elapsed * Math.max(1, p.getRate()) + JUMP_S;
    return time < last.pos - JUMP_S || time > max;
  }

  private catchUp(p: PlayerAdapter, now: number): void {
    const target = this.expected(now);
    const duration = p.getDuration();
    if (duration > 0 && target >= duration - 0.5) {
      // The shared playhead ran off the end (e.g. replay after the video
      // finished); make our position the shared one instead.
      this.commit({ position: p.getTime() }, false);
      return;
    }
    this.lastCatchUp = now;
    this.hold(now);
    p.seek(target + 0.3); // a little ahead, to cover the time the seek takes
  }

  private tick(): void {
    const p = this.player;
    if (!p) return;
    const now = this.now();
    const s = this.state;
    const ps = p.getState();
    const time = p.getTime();

    if (s.videoId && this.loadedId === s.videoId && !this.error && now >= this.holdUntil && !this.hidden()) {
      if (!isFresh(ps) && this.jumped(time, p, now)) {
        this.commit({ position: time }, false); // scrubbed inside the YouTube frame
      } else if (s.playing && ps === PS.PLAYING && now - this.lastCatchUp > DRIFT_COOLDOWN_MS) {
        if (Math.abs(time - this.expected(now)) > DRIFT_S) this.catchUp(p, now);
      }
    }

    this.last = { pos: time, wall: now, duration: p.getDuration(), started: !isFresh(ps) };
    this.refresh();
  }

  private refresh(force = false): void {
    const p = this.player;
    const ps = p ? p.getState() : PS.UNSTARTED;
    const loaded = p !== null && this.loadedId === this.state.videoId;
    // Before the video has started on this device, show the shared playhead.
    const time = p && loaded && !isFresh(ps) ? p.getTime() : this.expected();
    const next: PlayerView = {
      hasPlayer: p !== null,
      state: ps,
      time: Math.round(time * 4) / 4,
      duration: p && loaded ? p.getDuration() : 0,
      needsTap: this.needsTap,
      error: this.error,
    };
    const prev = this.view;
    const changed =
      prev.hasPlayer !== next.hasPlayer ||
      prev.state !== next.state ||
      prev.time !== next.time ||
      prev.duration !== next.duration ||
      prev.needsTap !== next.needsTap ||
      prev.error !== next.error;
    if (changed) this.view = next;
    if (changed || force) this.deps.onChange();
  }
}
