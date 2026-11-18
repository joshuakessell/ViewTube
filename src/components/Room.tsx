import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PS } from '../lib/player';
import { addRecent, listRecents } from '../lib/recents';
import { inviteLink } from '../lib/roomCode';
import { RoomSession, type RoomSnapshot } from '../lib/roomSession';
import { useCanSearch } from '../lib/search';
import { buzz, cx, morph, useMediaQuery } from '../lib/ui';
import { usePlaylist } from '../lib/usePlaylist';
import { thumbnailUrl, useVideoInfo } from '../lib/videoInfo';
import { parseYouTubeUrl, type ParsedVideo } from '../lib/youtube';
import { CallPane } from './CallPane';
import { Icon, type IconName } from './Icon';
import type { Joined } from './Lobby';
import { NowPlaying } from './NowPlaying';
import { VideoPane } from './VideoPane';
import { VideoPicker } from './VideoPicker';

type Front = 'video' | 'call';

interface RoomProps {
  joined: Joined;
  initialVideo: ParsedVideo | null;
  onInitialVideoUsed(): void;
  onLeave(): void;
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
  const [picking, setPicking] = useState(false);
  const [hasRecents, setHasRecents] = useState(() => listRecents().length > 0);
  const [toast, showToast] = useToast(snap.notice, joined.problem);
  const portrait = useMediaQuery('(orientation: portrait)');
  const { sync } = session;
  const { videoId } = snap.playback;
  const info = useVideoInfo(videoId);
  const canSearch = useCanSearch();
  const playlist = usePlaylist({
    room: joined.room,
    changedElsewhere: snap.playlistChanges,
    announce: session.announcePlaylist,
    onProblem: showToast,
  });

  useWakeLock();

  // A newly picked video comes to the front, whoever picked it.
  const seenVideo = useRef(videoId);
  const frontNow = useRef(front);
  frontNow.current = front;
  const showVideo = useCallback(() => {
    if (frontNow.current !== 'video') morph(() => setFront('video'));
  }, []);
  useEffect(() => {
    if (videoId && videoId !== seenVideo.current) showVideo();
    seenVideo.current = videoId;
  }, [videoId, showVideo]);

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

  // Remember what was watched, and name the tab after it.
  useEffect(() => {
    if (!videoId || !info) return;
    addRecent({ videoId, title: info.title, author: info.author });
    setHasRecents(true);
  }, [videoId, info]);
  useEffect(() => {
    document.title = info ? `${info.title} · ViewTube` : 'ViewTube';
    return () => {
      document.title = 'ViewTube';
    };
  }, [info]);

  // When a video from the playlist ends, the one after it starts for both.
  // One phone does this, so the next video isn't started twice; the other
  // steps in only if that somehow doesn't happen.
  const ended = videoId !== null && snap.player.state === PS.ENDED;
  const at = playlist.items.findIndex((item) => item.videoId === videoId);
  const nextId = at >= 0 ? (playlist.items[at + 1]?.videoId ?? null) : null;
  const peerId = snap.peer?.id ?? null;
  useEffect(() => {
    if (!ended || !nextId) return;
    const leads = peerId === null || session.selfId > peerId;
    const timer = setTimeout(() => sync.setVideo(nextId, 0, true), leads ? 900 : 4500);
    return () => clearTimeout(timer);
  }, [ended, nextId, peerId, session, sync]);

  const duration = snap.player.duration > 0 ? Math.round(snap.player.duration) : null;
  const saved = videoId !== null && playlist.has(videoId);
  const toggleSaved = () => {
    if (!videoId) return;
    buzz();
    if (saved) playlist.remove(videoId);
    else playlist.add({ videoId, title: info?.title ?? 'YouTube video', author: info?.author ?? '', duration, addedBy: joined.name });
  };

  // Real browser fullscreen where it exists (Android); on iPhone, which has no
  // such API for pages, the pane simply fills the window.
  const enterFull = useCallback(() => {
    buzz();
    morph(() => setFull(true));
    try {
      void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
    } catch {
      // filling the window is enough
    }
  }, []);
  const exitFull = useCallback(() => {
    morph(() => setFull(false));
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false); // left with the back gesture
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const bring = (next: Front) => {
    buzz();
    morph(() => setFront(next));
  };
  const swap = () => bring(front === 'video' ? 'call' : 'video');

  const closePicker = useCallback(() => setPicking(false), []);
  const pick = (video: ParsedVideo) => {
    sync.setVideo(video.videoId, video.start);
    setPicking(false);
    showVideo();
  };

  // One tap when the link is already on the clipboard; otherwise open the picker.
  const pasteLink = async () => {
    try {
      const video = parseYouTubeUrl(await navigator.clipboard.readText());
      if (video) {
        pick(video);
        return;
      }
    } catch {
      // no clipboard access: they can paste by hand
    }
    setPicking(true);
  };

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
  const here = presence(snap);
  const toggleMic = () => {
    buzz();
    session.setMic(!snap.mic);
  };

  return (
    <div className={cx('room', `front-${front}`, full && 'full', !videoId && 'no-video')}>
      <Ambient videoId={videoId} />

      <header className="topbar">
        <div className={cx('presence', here.tone)} role="status">
          <i aria-hidden="true" />
          <span>{here.text}</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="chip icon-only" onClick={invite} aria-label="Invite someone" title="Invite">
            <Icon name="invite" size={19} />
          </button>
          <button type="button" className={cx('chip', !videoId && 'accent')} onClick={() => setPicking(true)} aria-label="Pick a video">
            <Icon name={canSearch ? 'search' : 'plus'} size={17} weight="bold" />
            <span>Videos</span>
          </button>
        </div>
      </header>

      <VideoPane
        sync={sync}
        videoId={videoId}
        view={snap.player}
        isFront={front === 'video'}
        floating={portrait && front === 'call' && !full}
        canSearch={canSearch}
        hasSaved={hasRecents || playlist.items.length > 0}
        onBringFront={() => bring('video')}
        onPaste={pasteLink}
        onBrowse={() => setPicking(true)}
      />

      {videoId && (
        <NowPlaying
          sync={sync}
          playback={snap.playback}
          view={snap.player}
          info={info}
          peerName={snap.peer?.name ?? null}
          saved={saved}
          onToggleSaved={toggleSaved}
        />
      )}

      <CallPane
        snap={snap}
        local={joined.stream}
        selfName={joined.name}
        isFront={front === 'call'}
        onBringFront={() => bring('call')}
        onRetry={() => session.retryCall()}
        onInvite={invite}
      />

      <nav className="dock" aria-label="Call controls">
        <DockButton
          icon={snap.mic ? 'mic' : 'micOff'}
          label={!hasMic ? 'No microphone' : snap.mic ? 'Mute microphone' : 'Unmute microphone'}
          off={!snap.mic}
          disabled={!hasMic}
          onClick={toggleMic}
        />
        <DockButton
          icon={snap.cam ? 'cam' : 'camOff'}
          label={!hasCam ? 'No camera' : snap.cam ? 'Turn camera off' : 'Turn camera on'}
          off={!snap.cam}
          disabled={!hasCam}
          onClick={() => {
            buzz();
            session.setCam(!snap.cam);
          }}
        />
        <DockButton icon={portrait ? 'swapV' : 'swapH'} label={`Bring the ${other} to the front`} onClick={swap} />
        <DockButton icon="expand" label={`Make the ${front} full screen`} onClick={enterFull} />
        <DockButton icon="leave" label="Leave" danger onClick={onLeave} />
      </nav>

      {full && (
        <FullControls>
          {hasMic && (
            <button
              type="button"
              className={cx(!snap.mic && 'off')}
              onClick={toggleMic}
              aria-label={snap.mic ? 'Mute microphone' : 'Unmute microphone'}
            >
              <Icon name={snap.mic ? 'mic' : 'micOff'} size={20} weight="fill" />
            </button>
          )}
          <button type="button" onClick={swap} aria-label={`Switch to the ${other}`} title={`Switch to the ${other}`}>
            <Icon name={portrait ? 'swapV' : 'swapH'} size={20} weight="bold" />
          </button>
          <button type="button" onClick={exitFull} aria-label="Exit full screen" title="Exit full screen">
            <Icon name="shrink" size={20} weight="bold" />
          </button>
        </FullControls>
      )}

      {picking && (
        <VideoPicker
          playlist={playlist}
          current={videoId ? { videoId, info, duration } : null}
          selfName={joined.name}
          canSearch={canSearch}
          onPick={pick}
          onClose={closePicker}
        />
      )}

      {toast && (
        <div className="toast" role="status" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

// --- who is here ---------------------------------------------------------------------------------

function presence({ link, peer, call }: RoomSnapshot): { text: string; tone: 'live' | 'busy' | 'idle' | 'bad' } {
  if (!peer) {
    if (link === 'connecting') return { text: 'Opening the room…', tone: 'busy' };
    if (link === 'lost') return { text: 'Reconnecting…', tone: 'busy' };
    if (link === 'full') return { text: 'Room is full', tone: 'bad' };
    return { text: 'Just you so far', tone: 'idle' };
  }
  if (call === 'connected') return { text: `With ${peer.name}`, tone: 'live' };
  if (call === 'failed') return { text: 'Call didn’t connect', tone: 'bad' };
  return { text: `Connecting to ${peer.name}…`, tone: 'busy' };
}

// --- the glow behind everything ------------------------------------------------------------------

/**
 * Lights the room with whatever is on: a heavily blurred still of the video,
 * the way a television colours a dark living room. The previous still stays
 * underneath while the next one fades in over it.
 */
function Ambient({ videoId }: { videoId: string | null }) {
  const [stills, setStills] = useState<string[]>(() => (videoId ? [videoId] : []));
  useEffect(() => {
    if (videoId) setStills((list) => (list[list.length - 1] === videoId ? list : [...list.slice(-1), videoId]));
  }, [videoId]);

  return (
    <div className="ambient" aria-hidden="true">
      {stills.map((id) => (
        <div key={id} className="ambient-still" style={{ backgroundImage: `url(${thumbnailUrl(id)})` }} />
      ))}
      <div className="ambient-shade" />
    </div>
  );
}

// --- controls ------------------------------------------------------------------------------------

function DockButton({
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
      className={cx('dock-btn', off && 'off', danger && 'danger')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={24} weight={off || danger ? 'bold' : 'regular'} />
    </button>
  );
}

const DIM_AFTER_MS = 3000;

/** The few buttons left in full screen. They fade back after a moment so they don't sit on the picture. */
function FullControls({ children }: { children: React.ReactNode }) {
  const [dim, setDim] = useState(false);
  useEffect(() => {
    let timer = setTimeout(() => setDim(true), DIM_AFTER_MS);
    const wake = () => {
      setDim(false);
      clearTimeout(timer);
      timer = setTimeout(() => setDim(true), DIM_AFTER_MS);
    };
    window.addEventListener('pointerdown', wake, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', wake, true);
    };
  }, []);
  return <div className={cx('full-controls', dim && 'dim')}>{children}</div>;
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
