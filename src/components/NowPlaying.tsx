import { useRef, useState, type CSSProperties } from 'react';
import type { Playback, PlaybackSync, PlayerView } from '../lib/playbackSync';
import { PS } from '../lib/player';
import { buzz, cx, formatTime } from '../lib/ui';
import type { VideoInfo } from '../lib/videoInfo';
import { Icon } from './Icon';

const SKIP_S = 10;

interface NowPlayingProps {
  sync: PlaybackSync;
  playback: Playback;
  view: PlayerView;
  info: VideoInfo | null;
  /** Who else these controls reach, for the wording. */
  peerName: string | null;
  /** Whether this video is in the room's playlist. */
  saved: boolean;
  onToggleSaved(): void;
}

/** What is playing, and the remote control that works both phones at once. */
export function NowPlaying({ sync, playback, view, info, peerName, saved, onToggleSaved }: NowPlayingProps) {
  // While the thumb is being dragged, show the drag position and send one seek on release.
  const [drag, setDrag] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  const usable = playback.videoId !== null && !view.error;
  const seekable = usable && view.duration > 0;
  const ended = view.duration > 0 && view.time >= view.duration - 0.5;
  const showPause = playback.playing && !ended;
  const buffering = playback.playing && view.state === PS.BUFFERING;
  const time = seekable ? (drag ?? Math.min(view.time, view.duration)) : view.time;
  const fill = seekable ? Math.min(100, (time / view.duration) * 100) : 0;
  const both = peerName ? ' for both of you' : '';

  const release = () => {
    if (dragRef.current === null) return;
    sync.seek(dragRef.current);
    dragRef.current = null;
    setDrag(null);
  };

  const skip = (by: number) => {
    buzz();
    sync.seek(Math.max(0, Math.min(view.duration - 1, view.time + by)));
  };

  return (
    <div className={cx('now', !usable && 'unusable')}>
      <div className="now-row">
        <button
          type="button"
          className={cx('play', buffering && 'busy')}
          disabled={!usable}
          onClick={() => {
            buzz();
            if (showPause) sync.pause();
            else sync.play();
          }}
          aria-label={showPause ? `Pause${both}` : `Play${both}`}
        >
          <Icon name={showPause ? 'pause' : 'play'} size={22} weight="fill" />
        </button>

        <div className="now-meta">
          <strong>{info?.title ?? 'YouTube video'}</strong>
          <div className="now-sub">
            <span>{info?.author || (peerName ? `Playing for you and ${peerName}` : 'Ready when you are')}</span>
            <button
              type="button"
              className={cx('save-chip', saved && 'saved')}
              onClick={onToggleSaved}
              aria-pressed={saved}
              aria-label={saved ? 'Remove this video from the playlist' : 'Add this video to the playlist'}
            >
              <Icon name={saved ? 'check' : 'plus'} size={13} weight="bold" />
              {saved ? 'Saved' : 'Playlist'}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="skip"
          disabled={!seekable}
          onClick={() => skip(-SKIP_S)}
          aria-label={`Back ${SKIP_S} seconds${both}`}
        >
          <Icon name="back" size={26} />
          <span aria-hidden="true">{SKIP_S}</span>
        </button>
        <button
          type="button"
          className="skip"
          disabled={!seekable}
          onClick={() => skip(SKIP_S)}
          aria-label={`Forward ${SKIP_S} seconds${both}`}
        >
          <Icon name="forward" size={26} />
          <span aria-hidden="true">{SKIP_S}</span>
        </button>
      </div>

      <div className="scrub">
        <span className="scrub-time">{usable ? formatTime(time) : '–:––'}</span>
        <input
          className="scrub-range"
          type="range"
          min={0}
          max={seekable ? Math.floor(view.duration) : 1}
          step={1}
          value={seekable ? time : 0}
          disabled={!seekable}
          style={{ '--fill': `${fill}%` } as CSSProperties}
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
        <span className="scrub-time end">{seekable ? formatTime(view.duration) : '–:––'}</span>
      </div>
    </div>
  );
}
