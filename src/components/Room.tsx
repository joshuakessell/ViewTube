import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CallStatus } from '../lib/call';
import type { Playback, PlaybackSync, PlayerView } from '../lib/playbackSync';
import { PS } from '../lib/player';
import { inviteLink } from '../lib/roomCode';
import { RoomSession, type PeerInfo, type RoomSnapshot } from '../lib/roomSession';
import { mountYouTubePlayer, parseYouTubeUrl, type ParsedVideo } from '../lib/youtube';
import { Icon, type IconName } from './Icon';
import type { Joined } from './Lobby';

type Front = 'video' | 'call';

interface RoomProps {
  joined: Joined;
  initialVideo: ParsedVideo | null;
  onInitialVideoUsed(): void;
  onLeave(): void;
}

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function Room(props: RoomProps) {
  const { room, name, stream } = props.joined;
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    const created = new RoomSession({ room, name, local: stream });
    created.start();
    setSession(created);
    return () => created.leave();
  }, [room, name, stream]);

  if (!session) return <div className="room" />;
  return <RoomView key={session.selfId} session={session} {...props} />;
}

function RoomView({ session, joined, initialVideo, onInitialVideoUsed, onLeave }: RoomProps & { session: RoomSession }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [front, setFront] = useState<Front>('video');
  const [full, setFull] = useState(false);
  const [toast, showToast] = useToast(snap.notice, joined.problem);
  const { sync } = session;
  const { videoId } = snap.playback;

  useWakeLock();

  // A newly picked video comes to the front, whoever picked it.
  const seenVideo = useRef(videoId);
  useEffect(() => {
    if (videoId && videoId !== seenVideo.current) setFront('video');
    seenVideo.current = videoId;
  }, [videoId]);

  // A link shared into the app: cue it once we know what the room is already
  // watching (so we build on that state rather than race it), or after a short
  // wait if nobody else is here.
  const hasPeer = snap.peer !== null;
  useEffect(() => {
    if (!initialVideo) return;
    const cue = () => {
      sync.setVideo(initialVideo.videoId, initialVideo.start);
      onInitialVideoUsed();
    };
    if (hasPeer) {
      cue();
      return;
    }
    const timer = setTimeout(cue, 2500);
    return () => clearTimeout(timer);
  }, [initialVideo, hasPeer, sync, onInitialVideoUsed]);

  // Real browser fullscreen where it exists (Android); on iPhone, which has no
  // such API for pages, the pane simply fills the window.
  const enterFull = useCallback(() => {
    setFull(true);
    try {
      void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
    } catch {
      // filling the window is enough
    }
  }, []);
  const exitFull = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false); // left with the back gesture
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const swap = () => setFront((current) => (current === 'video' ? 'call' : 'video'));

  const invite = async () => {
    const url = inviteLink(joined.room);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'ViewTube', text: 'Watch with me on ViewTube', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast('Invite link copied');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // share sheet dismissed
      showToast(`Room code: ${joined.room}`);
    }
  };

  const hasMic = Boolean(joined.stream?.getAudioTracks().length);
  const hasCam = Boolean(joined.stream?.getVideoTracks().length);
  const other = front === 'video' ? 'call' : 'video';

  return (
    <div className={cx('room', `front-${front}`, full && 'full')}>
      <LinkBar
        onVideo={(video) => {
          sync.setVideo(video.videoId, video.start);
          setFront('video');
        }}
        onInvalid={() => showToast('That doesn’t look like a YouTube link')}
      />

      <VideoPane sync={sync} videoId={videoId} view={snap.player} isFront={front === 'video'} onBringFront={() => setFront('video')} />

      <CallPane
        snap={snap}
        local={joined.stream}
        isFront={front === 'call'}
        onBringFront={() => setFront('call')}
        onRetry={() => session.retryCall()}
      />

      <TransportBar sync={sync} playback={snap.playback} view={snap.player} />

      <div className="actions">
        <ActionButton
          icon={snap.mic ? 'mic' : 'micOff'}
          label={!hasMic ? 'No microphone' : snap.mic ? 'Mute microphone' : 'Unmute microphone'}
          off={!snap.mic}
          disabled={!hasMic}
          onClick={() => session.setMic(!snap.mic)}
        />
        <ActionButton
          icon={snap.cam ? 'cam' : 'camOff'}
          label={!hasCam ? 'No camera' : snap.cam ? 'Turn camera off' : 'Turn camera on'}
          off={!snap.cam}
          disabled={!hasCam}
          onClick={() => session.setCam(!snap.cam)}
        />
        <ActionButton icon="swap" label={`Bring the ${other} to the front`} onClick={swap} />
        <ActionButton icon="expand" label={`Make the ${front} full screen`} onClick={enterFull} />
        <ActionButton icon="share" label="Invite" onClick={invite} />
        <ActionButton icon="leave" label="Leave" danger onClick={onLeave} />
      </div>

      {full && (
        <div className="full-controls">
          <button type="button" onClick={swap} aria-label={`Switch to the ${other}`} title={`Switch to the ${other}`}>
            <Icon name="swap" size={20} />
          </button>
          <button type="button" onClick={exitFull} aria-label="Exit full screen" title="Exit full screen">
            <Icon name="shrink" size={20} />
          </button>
        </div>
      )}

      {toast && (
        <div className="toast" role="status" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

// --- the YouTube side ------------------------------------------------------------------------

function VideoPane({
  sync,
  videoId,
  view,
  isFront,
  onBringFront,
}: {
  sync: PlaybackSync;
  videoId: string | null;
  view: PlayerView;
  isFront: boolean;
  onBringFront(): void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const hasVideo = videoId !== null;

  // The player is created once, for the first video; later videos are loaded
  // into the same iframe. (After the user has tapped play in it once, iOS lets
  // scripts control it, and that only holds for as long as the iframe lives.)
  useEffect(() => {
    const host = hostRef.current;
    const cue = hasVideo ? sync.initialCue() : null;
    if (!host || !cue) return;
    const unmount = mountYouTubePlayer(host, cue, {
      onReady: (player) => sync.attachPlayer(player, cue.videoId, cue.start),
      onState: sync.onPlayerState,
      onRate: sync.onPlayerRate,
      onError: sync.onPlayerError,
      onLoadFailed: sync.onLoadFailed,
    });
    return () => {
      sync.detachPlayer();
      unmount();
    };
  }, [hasVideo, sync]);

  return (
    <section className={cx('pane pane-video', isFront && 'is-front')} aria-label="YouTube video">
      <div className="yt-host" ref={hostRef} />
      {!hasVideo && (
        <div className="pane-empty">
          <strong>Nothing playing yet</strong>
          <span>Paste a YouTube link and it shows up here for both of you.</span>
        </div>
      )}
      {view.error && <div className="pane-banner error">{view.error}</div>}
      {view.needsTap && !view.error && (
        <div className="pane-banner">{isFront ? 'Tap play on the video to start it on this phone' : 'Tap to start the video'}</div>
      )}
      {!isFront && <button type="button" className="pane-tap" onClick={onBringFront} aria-label="Bring the video to the front" />}
    </section>
  );
}

// --- the call side -----------------------------------------------------------------------------

function callStatusText(link: RoomSnapshot['link'], peer: PeerInfo | null, call: CallStatus): string | null {
  if (!peer) {
    if (link === 'connecting') return 'Connecting…';
    if (link === 'lost') return 'Connection lost. Retrying…';
    if (link === 'full') return 'Two people are already in this room';
    return 'Waiting for the other person to join';
  }
  switch (call) {
    case 'connected':
      return null;
    case 'reconnecting':
      return 'Reconnecting…';
    case 'failed':
      return 'The call couldn’t connect';
    default:
      return `Connecting to ${peer.name}…`;
  }
}

function CallPane({
  snap,
  local,
  isFront,
  onBringFront,
  onRetry,
}: {
  snap: RoomSnapshot;
  local: MediaStream | null;
  isFront: boolean;
  onBringFront(): void;
  onRetry(): void;
}) {
  const { peer, remoteStream, call, link } = snap;
  const remoteRef = useRef<HTMLVideoElement>(null);
  const selfRef = useRef<HTMLVideoElement>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);

  useEffect(() => {
    const el = remoteRef.current;
    if (!el) return;
    el.srcObject = remoteStream;
    if (!remoteStream) return;
    el.play().then(
      () => setSoundBlocked(false),
      // Only possible without a mic: with no capture running, browsers want a tap before playing sound.
      (err: unknown) => setSoundBlocked(err instanceof DOMException && err.name === 'NotAllowedError'),
    );
  }, [remoteStream]);

  useEffect(() => {
    const el = selfRef.current;
    if (!el) return;
    el.muted = true; // never play our own microphone back
    el.srcObject = local;
    if (local) el.play().catch(() => {});
  }, [local]);

  const unblockSound = () => {
    remoteRef.current?.play().then(() => setSoundBlocked(false), () => {});
  };

  const status = callStatusText(link, peer, call);
  const seeThem = Boolean(peer?.cam && call === 'connected' && remoteStream?.getVideoTracks().length);
  const blocked = soundBlocked && remoteStream !== null;

  return (
    <section className={cx('pane pane-call', isFront && 'is-front')} aria-label="Video call">
      <video ref={remoteRef} className={cx('remote', !seeThem && 'hidden')} autoPlay playsInline />

      {!seeThem && (
        <div className="call-empty">
          <div className="avatar" aria-hidden="true">
            {peer ? peer.name.slice(0, 1).toUpperCase() : '…'}
          </div>
          <span>{status ?? `${peer?.name ?? ''} has their camera off`}</span>
        </div>
      )}

      {peer && (
        <div className="name-tag">
          {peer.name}
          {!peer.mic && <Icon name="micOff" size={14} />}
        </div>
      )}
      {seeThem && status && <div className="pane-banner">{status}</div>}

      <video ref={selfRef} className={cx('selfview', !snap.cam && 'hidden')} autoPlay playsInline muted />

      {!isFront && <button type="button" className="pane-tap" onClick={onBringFront} aria-label="Bring the call to the front" />}

      {/* Above the tap layer so they stay usable when the call is the small tile. */}
      {call === 'failed' && (
        <button type="button" className="btn pane-action" onClick={onRetry}>
          Try again
        </button>
      )}
      {blocked && call !== 'failed' && (
        <button type="button" className="btn primary pane-action" onClick={unblockSound}>
          Tap to hear {peer?.name ?? 'them'}
        </button>
      )}
    </section>
  );
}

// --- controls --------------------------------------------------------------------------------------

function LinkBar({ onVideo, onInvalid }: { onVideo(video: ParsedVideo): void; onInvalid(): void }) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const canReadClipboard = typeof navigator.clipboard?.readText === 'function';

  const submit = (raw: string) => {
    const video = parseYouTubeUrl(raw);
    if (!video) {
      onInvalid();
      return;
    }
    setText('');
    inputRef.current?.blur();
    onVideo(video);
  };

  const pasteFromClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (parseYouTubeUrl(clip)) submit(clip);
      else onInvalid();
    } catch {
      inputRef.current?.focus(); // permission refused: let them paste by hand
    }
  };

  return (
    <form
      className="linkbar"
      onSubmit={(event) => {
        event.preventDefault();
        submit(text);
      }}
    >
      <input
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => {
          // Pasting a link is the whole gesture; no need to also press a button.
          const pasted = event.clipboardData.getData('text');
          if (parseYouTubeUrl(pasted)) {
            event.preventDefault();
            submit(pasted);
          }
        }}
        placeholder="Paste a YouTube link"
        aria-label="YouTube link"
        inputMode="url"
        enterKeyHint="go"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
      />
      {text.trim() === '' && canReadClipboard ? (
        <button type="button" className="btn" onClick={pasteFromClipboard} aria-label="Paste link from clipboard" title="Paste">
          <Icon name="paste" size={20} />
        </button>
      ) : (
        <button type="submit" className="btn primary" disabled={text.trim() === ''}>
          Watch
        </button>
      )}
    </form>
  );
}

function TransportBar({ sync, playback, view }: { sync: PlaybackSync; playback: Playback; view: PlayerView }) {
  // While the thumb is being dragged, show the drag position and send one seek on release.
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  const usable = playback.videoId !== null && !view.error;
  const seekable = usable && view.duration > 0;
  const ended = view.duration > 0 && view.time >= view.duration - 0.5;
  const showPause = playback.playing && !ended;
  const buffering = playback.playing && view.state === PS.BUFFERING;
  const time = seekable ? (drag ?? Math.min(view.time, view.duration)) : view.time;

  const release = () => {
    if (dragRef.current === null) return;
    sync.seek(dragRef.current);
    dragRef.current = null;
    setDrag(null);
  };

  return (
    <div className="transport">
      <button
        type="button"
        className={cx('btn round primary', buffering && 'busy')}
        disabled={!usable}
        onClick={() => (showPause ? sync.pause() : sync.play())}
        aria-label={showPause ? 'Pause for both of you' : 'Play for both of you'}
      >
        <Icon name={showPause ? 'pause' : 'play'} />
      </button>
      <div className="scrub">
        <input
          type="range"
          min={0}
          max={seekable ? Math.floor(view.duration) : 1}
          step={1}
          value={seekable ? time : 0}
          disabled={!seekable}
          onChange={(event) => {
            dragRef.current = Number(event.target.value);
            setDrag(dragRef.current);
          }}
          onPointerUp={release}
          onTouchEnd={release}
          onKeyUp={release}
          onBlur={release}
          aria-label="Position in the video"
          aria-valuetext={formatTime(time)}
        />
        <div className="times">
          <span>{usable ? formatTime(time) : '–:––'}</span>
          <span>{seekable ? formatTime(view.duration) : '–:––'}</span>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  off,
  danger,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick(): void;
  off?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx('btn action', off && 'off', danger && 'danger')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
    </button>
  );
}

// --- small hooks -----------------------------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
}

/** Shows room notices ("Zak joined") and local messages for a few seconds each. */
function useToast(notice: RoomSnapshot['notice'], initial: string | null): [Toast | null, (text: string) => void] {
  const [toast, setToast] = useState<Toast | null>(() => (initial ? { id: -1, text: initial } : null));
  const noticeId = notice?.id;
  const noticeText = notice?.text;

  useEffect(() => {
    if (noticeId !== undefined && noticeText) setToast({ id: noticeId, text: noticeText });
  }, [noticeId, noticeText]);

  useEffect(() => {
    if (!toast) return;
    // The camera/mic explanation is long; leave it up for a while.
    const timer = setTimeout(() => setToast(null), toast.id === -1 ? 9000 : 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const show = useCallback((text: string) => setToast({ id: Date.now(), text }), []);
  return [toast, show];
}

/** Keeps the screen on while in a room. */
function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.hidden) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        // low battery mode etc.; playing video keeps the screen on anyway
      }
    };
    void acquire();
    // The lock is dropped whenever the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => {});
    };
  }, []);
}
