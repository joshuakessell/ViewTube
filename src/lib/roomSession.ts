import { ICE_SERVERS } from '../config';
import { Call, type CallStatus } from './call';
import { PlaybackSync, type Playback, type PlayerView } from './playbackSync';
import { openTransport, type Msg, type Transport } from './transport';

export interface PeerInfo {
  id: string;
  name: string;
  mic: boolean;
  cam: boolean;
}

export interface RoomSnapshot {
  /** The relay both phones talk through (not the call itself). 'full': two others are already here. */
  link: 'connecting' | 'open' | 'lost' | 'full';
  peer: PeerInfo | null;
  call: CallStatus;
  remoteStream: MediaStream | null;
  playback: Playback;
  player: PlayerView;
  mic: boolean;
  cam: boolean;
  notice: { id: number; text: string } | null;
}

export interface RoomOptions {
  room: string;
  name: string;
  local: MediaStream | null;
}

const HELLO_EVERY_MS = 4000;
const PEER_SILENCE_MS = 25_000;
/** How long the current partner gets to prove they are still here when someone new shows up. */
const CHALLENGE_MS = 2500;

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * One visit to a room: finds the other person, runs the call, and keeps the
 * two YouTube players in step. Plain class (no React) with a
 * subscribe/getSnapshot pair for `useSyncExternalStore`.
 */
export class RoomSession {
  readonly selfId = makeId();
  readonly sync: PlaybackSync;

  private transport: Transport | null = null;
  private call: Call | null = null;
  private peer: PeerInfo | null = null;
  /**
   * Identifies the current connection attempt. Both sides must agree on it,
   * so a peer connection is never fed signals meant for an older one.
   */
  private sid = 0;
  private maxSid = 0;
  private link: 'connecting' | 'open' | 'lost' = 'connecting';
  /** Two other devices are already paired in this room. */
  private full = false;
  private helloTicks = 0;
  private challenger: (Extract<Msg, { t: 'hello' }> & { asked: number }) | null = null;
  private challengeTimer: ReturnType<typeof setTimeout> | undefined;
  private callStatus: CallStatus = 'idle';
  private remoteStream: MediaStream | null = null;
  private notice: RoomSnapshot['notice'] = null;
  private noticeId = 0;

  /** Estimated (peer clock - our clock) in ms, from ping round trips. */
  private offset = 0;
  private samples: { rtt: number; offset: number }[] = [];
  private pings = 0;
  private lastHeard = 0;
  private mismatchAt = 0;
  private helloTimer: ReturnType<typeof setInterval> | undefined;
  private pingTimer: ReturnType<typeof setTimeout> | undefined;

  private stopped = false;
  private readonly listeners = new Set<() => void>();
  private snapshot: RoomSnapshot;

  constructor(private readonly opts: RoomOptions) {
    this.sync = new PlaybackSync({
      selfId: this.selfId,
      peerOffset: () => this.offset,
      send: (state) => this.send({ t: 'playback', from: this.selfId, state }),
      onChange: () => this.emit(),
    });
    this.snapshot = this.build();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): RoomSnapshot => this.snapshot;

  start(): void {
    this.transport = openTransport(this.opts.room, {
      onOpen: () => {
        if (this.stopped) return;
        this.link = 'open';
        if (this.peer) this.ping();
        else this.hello();
        this.emit();
      },
      onClose: () => {
        if (this.stopped) return;
        this.link = 'lost';
        this.emit();
      },
      onMessage: (msg) => this.onMessage(msg),
    });
    // Broadcasts aren't guaranteed to arrive, so keep announcing until someone answers.
    this.helloTimer = setInterval(() => {
      if (this.peer || this.link !== 'open') return;
      this.helloTicks += 1;
      if (this.full && this.helloTicks % 4 !== 0) return; // room is taken: knock less often
      this.hello();
    }, HELLO_EVERY_MS);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  leave(): void {
    if (this.stopped) return;
    this.send({ t: 'bye', from: this.selfId });
    this.stopped = true;
    clearInterval(this.helloTimer);
    clearTimeout(this.pingTimer);
    clearTimeout(this.challengeTimer);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.call?.close();
    this.call = null;
    const transport = this.transport;
    this.transport = null;
    setTimeout(() => transport?.close(), 250); // give the goodbye a moment to leave
  }

  setMic(on: boolean): void {
    this.opts.local?.getAudioTracks().forEach((track) => (track.enabled = on));
    this.announceMedia();
  }

  setCam(on: boolean): void {
    this.opts.local?.getVideoTracks().forEach((track) => (track.enabled = on));
    this.announceMedia();
  }

  retryCall(): void {
    this.call?.retry();
  }

  // --- messages ----------------------------------------------------------------------

  private onMessage(msg: Msg): void {
    if (this.stopped || msg.from === this.selfId) return;
    if ('to' in msg && msg.to !== this.selfId) return;
    if (this.peer?.id === msg.from) this.lastHeard = Date.now();

    switch (msg.t) {
      case 'hello':
        // They have no connection (just arrived, or lost it).
        if (this.peer && this.peer.id !== msg.from) this.challenge(msg);
        else this.accept(msg);
        break;
      case 'welcome': {
        if (this.peer && this.peer.id !== msg.from) break; // already paired with someone else
        // If we both said hello at once we each proposed a session; the higher id wins on both sides.
        const current = this.peer?.id === msg.from && this.sid >= msg.sid;
        if (current) this.updatePeer(msg.from, msg);
        else this.connect(msg, msg.sid);
        this.receivePlayback(msg.playback);
        break;
      }
      case 'bye':
        if (this.peer?.id === msg.from) this.dropPeer(`${this.peer.name} left`);
        break;
      case 'full':
        if (this.peer && this.peer.id !== msg.from) break;
        if (this.peer) this.dropPeer(null); // they are paired with someone else
        this.full = true;
        this.emit();
        break;
      case 'signal':
        if (this.peer?.id === msg.from && msg.sid === this.sid) this.call?.handleSignal(msg.signal);
        break;
      case 'ping': {
        if (this.peer && this.peer.id !== msg.from) {
          this.send({ t: 'full', from: this.selfId, to: msg.from });
          break;
        }
        if (!this.peer || msg.sid !== this.sid) {
          // They think they are connected to us and we disagree. If it lasts,
          // say hello, which makes both sides start over.
          const now = Date.now();
          if (this.mismatchAt && now - this.mismatchAt > 1000) {
            this.mismatchAt = 0;
            this.hello();
          } else if (!this.mismatchAt) {
            this.mismatchAt = now;
          }
          break;
        }
        this.mismatchAt = 0;
        this.send({ t: 'pong', from: this.selfId, to: msg.from, t0: msg.t0, t1: Date.now() });
        if (this.sync.isNewerThan(msg)) this.sendPlayback(); // they missed an update
        break;
      }
      case 'pong':
        if (this.peer?.id === msg.from) this.recordClockSample(msg.t0, msg.t1);
        break;
      case 'playback':
        this.receivePlayback(msg.state);
        break;
      case 'media':
        this.updatePeer(msg.from, msg);
        break;
    }
  }

  private receivePlayback(state: Playback): void {
    const before = this.sync.getPlayback().videoId;
    const result = this.sync.applyRemote(state);
    if (result === 'stale') this.sendPlayback();
    if (result === 'applied' && state.videoId && state.videoId !== before && this.peer) {
      this.say(`${this.peer.name} picked a video`);
    }
  }

  /** Start a fresh connection with whoever said hello, and tell them which session to use. */
  private accept(hello: Extract<Msg, { t: 'hello' }>): void {
    const sid = (this.maxSid = Math.max(Date.now(), this.maxSid + 1));
    this.connect(hello, sid);
    this.send({ t: 'welcome', to: hello.from, sid, playback: this.sync.wire(), ...this.presence() });
  }

  /**
   * Someone new said hello while we already have a partner. Usually that is a
   * third device and the room is full; but it can also be our partner coming
   * back after a reload whose goodbye never arrived. Ask the partner we know
   * to prove they are still there before deciding.
   */
  private challenge(hello: Extract<Msg, { t: 'hello' }>): void {
    if (this.challenger) return;
    this.challenger = { ...hello, asked: Date.now() };
    this.ping();
    this.challengeTimer = setTimeout(() => {
      const guest = this.challenger;
      this.challenger = null;
      if (!guest || this.stopped) return;
      // Our partner may have left and the newcomer taken their place while we
      // were checking; then there is nothing left to decide.
      if (this.peer?.id === guest.from) return;
      if (this.peer && this.lastHeard >= guest.asked) {
        this.send({ t: 'full', from: this.selfId, to: guest.from });
        return;
      }
      if (this.peer) this.dropPeer(`${this.peer.name} disconnected`);
      this.accept(guest);
    }, CHALLENGE_MS);
  }

  private connect(info: { from: string; name: string; mic: boolean; cam: boolean }, sid: number): void {
    const newPerson = this.peer?.id !== info.from;
    this.full = false;
    this.call?.close();
    this.sid = sid;
    this.maxSid = Math.max(this.maxSid, sid);
    this.mismatchAt = 0;
    this.peer = { id: info.from, name: info.name || 'Guest', mic: info.mic, cam: info.cam };
    this.remoteStream = null;
    this.callStatus = 'connecting';
    this.lastHeard = Date.now();

    const peerId = info.from;
    this.call = new Call({
      caller: this.selfId > peerId,
      iceServers: ICE_SERVERS,
      local: this.opts.local,
      sendSignal: (signal) => this.send({ t: 'signal', from: this.selfId, to: peerId, sid, signal }),
      onStatus: (status) => {
        if (this.sid !== sid) return;
        this.callStatus = status;
        this.emit();
      },
      onRemoteStream: (stream) => {
        if (this.sid !== sid) return;
        this.remoteStream = stream;
        this.emit();
      },
    });

    if (newPerson) {
      this.samples = [];
      this.pings = 0;
      this.say(`${this.peer.name} joined`);
    }
    this.schedulePing(600);
    this.emit();
  }

  private updatePeer(id: string, info: { mic: boolean; cam: boolean }): void {
    if (this.peer?.id !== id) return;
    this.peer = { ...this.peer, mic: info.mic, cam: info.cam };
    this.emit();
  }

  private dropPeer(reason: string | null): void {
    this.call?.close();
    this.call = null;
    this.peer = null;
    this.remoteStream = null;
    this.callStatus = 'idle';
    clearTimeout(this.pingTimer);
    if (reason) this.say(reason);
    this.emit();
  }

  // --- outgoing ------------------------------------------------------------------------

  private send(msg: Msg): void {
    if (!this.stopped) this.transport?.send(msg);
  }

  private presence() {
    const { mic, cam } = this.localMedia();
    return { from: this.selfId, name: this.opts.name, mic, cam };
  }

  private hello(): void {
    this.send({ t: 'hello', ...this.presence() });
  }

  private sendPlayback(): void {
    this.send({ t: 'playback', from: this.selfId, state: this.sync.wire() });
  }

  private announceMedia(): void {
    this.send({ t: 'media', from: this.selfId, ...this.localMedia() });
    this.emit();
  }

  private localMedia(): { mic: boolean; cam: boolean } {
    const local = this.opts.local;
    return {
      mic: local?.getAudioTracks().some((track) => track.enabled) ?? false,
      cam: local?.getVideoTracks().some((track) => track.enabled) ?? false,
    };
  }

  // --- heartbeat and clock ----------------------------------------------------------------

  private schedulePing(delay: number): void {
    clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => {
      this.ping();
      // Quick pings at first to pin down the clock offset, then a slow heartbeat.
      if (this.peer && !this.stopped) this.schedulePing(this.pings < 6 ? 1500 : 8000);
    }, delay);
  }

  private ping(): void {
    const peer = this.peer;
    if (!peer) return;
    const now = Date.now();
    // A connected call proves they are still there even if the relay is quiet.
    if (now - this.lastHeard > PEER_SILENCE_MS && this.callStatus !== 'connected') {
      this.dropPeer(`${peer.name} disconnected`);
      return;
    }
    this.pings += 1;
    const { rev, by } = this.sync.getPlayback();
    this.send({ t: 'ping', from: this.selfId, to: peer.id, sid: this.sid, t0: now, rev, by });
  }

  private recordClockSample(t0: number, t1: number): void {
    const rtt = Date.now() - t0;
    if (rtt < 0 || rtt > 10_000) return;
    // Assume the trip took equally long each way; the fastest round trip is the most trustworthy.
    this.samples.push({ rtt, offset: t1 - (t0 + rtt / 2) });
    if (this.samples.length > 8) this.samples.shift();
    this.offset = this.samples.reduce((best, sample) => (sample.rtt < best.rtt ? sample : best)).offset;
  }

  // --- browser events -----------------------------------------------------------------------

  private readonly onPageHide = (): void => {
    this.send({ t: 'bye', from: this.selfId });
  };

  private readonly onOnline = (): void => {
    this.call?.checkConnection();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden || this.stopped) return;
    this.sync.resync();
    this.call?.checkConnection();
    if (this.peer) this.schedulePing(0);
  };

  // --- snapshot ---------------------------------------------------------------------------------

  private say(text: string): void {
    this.notice = { id: ++this.noticeId, text };
  }

  private build(): RoomSnapshot {
    return {
      link: this.full && !this.peer && this.link === 'open' ? 'full' : this.link,
      peer: this.peer,
      call: this.callStatus,
      remoteStream: this.remoteStream,
      playback: this.sync.getPlayback(),
      player: this.sync.getView(),
      notice: this.notice,
      ...this.localMedia(),
    };
  }

  private emit(): void {
    if (this.stopped) return;
    this.snapshot = this.build();
    this.listeners.forEach((listener) => listener());
  }
}
