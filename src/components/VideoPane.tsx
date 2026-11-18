import { useEffect, useRef } from 'react';
import type { PlaybackSync, PlayerView } from '../lib/playbackSync';
import { cx } from '../lib/ui';
import { useCornerDrag } from '../lib/useCornerDrag';
import { mountYouTubePlayer } from '../lib/youtube';
import { Icon } from './Icon';

interface VideoPaneProps {
  sync: PlaybackSync;
  videoId: string | null;
  view: PlayerView;
  isFront: boolean;
  /** Shown as a small tile floating over the call, which can be dragged to another corner. */
  floating: boolean;
  /** Whether YouTube can be searched from here, or only links pasted. */
  canSearch: boolean;
  /** Whether the picker has anything saved to choose from. */
  hasSaved: boolean;
  onBringFront(): void;
  onPaste(): void;
  onBrowse(): void;
}

export function VideoPane({
  sync,
  videoId,
  view,
  isFront,
  floating,
  canSearch,
  hasSaved,
  onBringFront,
  onPaste,
  onBrowse,
}: VideoPaneProps) {
  const paneRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const corner = useCornerDrag(paneRef, floating, 'tr');
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
    <section
      ref={paneRef}
      className={cx('pane pane-video', isFront && 'is-front', floating && 'floating', !hasVideo && 'is-empty')}
      data-corner={floating ? corner : undefined}
      aria-label="YouTube video"
    >
      <div className="yt-host" ref={hostRef} />

      {!hasVideo && (
        <div className="video-empty">
          <div className="video-empty-art" aria-hidden="true" />
          <div className="video-empty-body">
            <h2>What are we watching?</h2>
            <p>
              {canSearch
                ? 'Search YouTube or paste a link. It plays for both of you.'
                : 'Paste a YouTube link and it plays for both of you.'}
            </p>
            <div className="video-empty-actions">
              {canSearch ? (
                <>
                  <button type="button" className="btn primary" onClick={onBrowse}>
                    <Icon name="search" size={19} weight="bold" />
                    Find a video
                  </button>
                  <button type="button" className="btn" onClick={onPaste}>
                    Paste link
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn primary" onClick={onPaste}>
                    <Icon name="paste" size={19} weight="bold" />
                    Paste link
                  </button>
                  {hasSaved && (
                    <button type="button" className="btn" onClick={onBrowse}>
                      Saved
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="video-empty-mini" aria-hidden="true">
            <Icon name="plus" size={20} weight="bold" />
            <span>Add a video</span>
          </div>
        </div>
      )}

      {view.error && <div className="pane-banner error">{view.error}</div>}
      {view.needsTap && !view.error && (
        <div className="pane-banner nudge">{isFront ? 'Tap play on the video to start it on this phone' : 'Tap to start the video'}</div>
      )}

      {!isFront && <button type="button" className="pane-tap" onClick={onBringFront} aria-label="Bring the video to the front" />}
    </section>
  );
}
