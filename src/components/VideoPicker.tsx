import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PlaylistItem } from '../lib/playlist';
import { listRecents } from '../lib/recents';
import { SearchError, searchYouTube, type FoundVideo } from '../lib/search';
import { cx, formatTime } from '../lib/ui';
import type { Playlist } from '../lib/usePlaylist';
import { thumbnailUrl, type VideoInfo } from '../lib/videoInfo';
import { parseYouTubeUrl, type ParsedVideo } from '../lib/youtube';
import { Icon } from './Icon';

const CLOSE_MS = 180;

type Tab = 'playlist' | 'recent';

type Search =
  | { query: string; status: 'loading' }
  | { query: string; status: 'done'; results: FoundVideo[] }
  | { query: string; status: 'failed'; message: string };

const SEARCH_PROBLEMS = {
  limit: 'YouTube search has reached today’s limit. Pasting a link still works, and search is back tomorrow.',
  off: 'Search isn’t switched on yet. Paste a link for now.',
  failed: 'Couldn’t search just now. Check your connection and try again.',
};

/** Text that is meant as a link, as opposed to words to search for. */
const looksLikeLink = (text: string): boolean => /^https?:\/\/|youtu\.?be|^www\./i.test(text);

interface VideoPickerProps {
  playlist: Playlist;
  /** What is on right now, if anything. */
  current: { videoId: string; info: VideoInfo | null; duration: number | null } | null;
  selfName: string;
  /** Whether YouTube can be searched from here, or only links pasted. */
  canSearch: boolean;
  onPick(video: ParsedVideo): void;
  onClose(): void;
}

/**
 * Where a video is chosen: search YouTube, paste a link, or pick from the
 * room's playlist or from what this phone watched before. Drops down from
 * the top so the phone keyboard never covers it.
 */
export function VideoPicker({ playlist, current, selfName, canSearch, onPick, onClose }: VideoPickerProps) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [search, setSearch] = useState<Search | null>(null);
  const [closing, setClosing] = useState(false);
  const [recents] = useState(listRecents);
  const [tab, setTab] = useState<Tab>(() => (playlist.items.length > 0 || recents.length === 0 ? 'playlist' : 'recent'));
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const running = useRef<AbortController | null>(null);
  const canReadClipboard = typeof navigator.clipboard?.readText === 'function';

  const close = () => setClosing(true);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(onClose, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [closing, onClose]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClosing(true);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      running.current?.abort();
    };
  }, []);

  const typed = text.trim();
  const typedLink = typed && (!canSearch || looksLikeLink(typed)) ? parseYouTubeUrl(typed) : null;

  const runSearch = async (query: string) => {
    running.current?.abort();
    const controller = (running.current = new AbortController());
    inputRef.current?.blur(); // put the keyboard away so the results can be seen
    setSearch({ query, status: 'loading' });
    try {
      const results = await searchYouTube(query, controller.signal);
      if (!controller.signal.aborted) setSearch({ query, status: 'done', results });
    } catch (err) {
      if (controller.signal.aborted) return;
      const kind = err instanceof SearchError ? err.problem : 'failed';
      setSearch({ query, status: 'failed', message: SEARCH_PROBLEMS[kind] });
    }
  };

  const submit = () => {
    if (!typed) return;
    if (typedLink) onPick(typedLink);
    else if (canSearch && !looksLikeLink(typed)) void runSearch(typed);
    else setProblem('That doesn’t look like a YouTube link.');
  };

  const pasteFromClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      const video = parseYouTubeUrl(clip);
      if (video) onPick(video);
      else setProblem('There’s no YouTube link on your clipboard. In YouTube, tap Share, then Copy link.');
    } catch {
      inputRef.current?.focus(); // permission refused: let them paste by hand
    }
  };

  const clearSearch = () => {
    running.current?.abort();
    setSearch(null);
    setText('');
  };

  const save = (video: { videoId: string; title: string; author: string; duration?: number | null }) =>
    playlist.add({ videoId: video.videoId, title: video.title, author: video.author, duration: video.duration ?? null, addedBy: selfName });

  /** The + beside a video: saves it, and shows a tick (which takes it out again) once saved. */
  const saveToggle = (video: { videoId: string; title: string; author: string; duration?: number | null }) => {
    const saved = playlist.has(video.videoId);
    return (
      <button
        type="button"
        className={cx('row-action', saved && 'done')}
        onClick={() => (saved ? playlist.remove(video.videoId) : save(video))}
        aria-label={saved ? `Remove “${video.title}” from the playlist` : `Add “${video.title}” to the playlist`}
        aria-pressed={saved}
      >
        <Icon name={saved ? 'check' : 'plus'} size={18} weight="bold" />
      </button>
    );
  };

  const play = (videoId: string) => onPick({ videoId, start: 0 });
  const offerCurrent = current !== null && playlist.loaded && !playlist.has(current.videoId);

  return (
    <div className={cx('sheet-layer', closing && 'closing')}>
      <button type="button" className="sheet-backdrop" onClick={close} aria-label="Close" tabIndex={-1} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Pick a video" ref={panelRef} tabIndex={-1}>
        <div className="sheet-head">
          <h2>Pick a video</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="close" size={20} weight="bold" />
          </button>
        </div>

        <form
          className="link-form"
          role={canSearch ? 'search' : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setProblem(null);
            }}
            onPaste={(event) => {
              // Pasting a link is the whole gesture; no need to also press a button.
              const pasted = parseYouTubeUrl(event.clipboardData.getData('text'));
              if (pasted) {
                event.preventDefault();
                onPick(pasted);
              }
            }}
            placeholder={canSearch ? 'Search YouTube or paste a link' : 'Paste a YouTube link'}
            aria-label={canSearch ? 'Search YouTube or paste a link' : 'YouTube link'}
            inputMode={canSearch ? 'search' : 'url'}
            enterKeyHint={canSearch && !typedLink ? 'search' : 'go'}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          {typed === '' && canReadClipboard ? (
            <button type="button" className="btn primary" onClick={pasteFromClipboard}>
              <Icon name="paste" size={19} weight="bold" />
              Paste
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={typed === ''}>
              {typedLink || !canSearch ? 'Watch' : 'Search'}
            </button>
          )}
        </form>
        {problem && (
          <p className="sheet-problem" role="alert">
            {problem}
          </p>
        )}

        {search ? (
          <section aria-label="Search results" aria-busy={search.status === 'loading'}>
            <div className="results-head">
              <h3>Results for “{search.query}”</h3>
              <button type="button" className="text-btn" onClick={clearSearch}>
                Clear
              </button>
            </div>
            {search.status === 'loading' && (
              <ul className="video-list" aria-hidden="true">
                {[0, 1, 2, 3].map((n) => (
                  <li key={n} className="video-row skeleton">
                    <span className="thumb" />
                    <span className="video-row-text">
                      <i />
                      <i />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {search.status === 'failed' && (
              <p className="sheet-problem" role="alert">
                {search.message}
              </p>
            )}
            {search.status === 'done' && search.results.length === 0 && <p className="sheet-tip">Nothing found. Try different words.</p>}
            {search.status === 'done' && search.results.length > 0 && (
              <ul className="video-list">
                {search.results.map((video) => (
                  <VideoRow key={video.videoId} video={video} onPlay={() => play(video.videoId)} action={saveToggle(video)} />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
            <div className="tabs" role="tablist" aria-label="Saved videos">
              <button type="button" role="tab" aria-selected={tab === 'playlist'} onClick={() => setTab('playlist')}>
                Playlist{playlist.items.length > 0 && <b>{playlist.items.length}</b>}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'recent'} onClick={() => setTab('recent')}>
                Watched before
              </button>
            </div>

            {tab === 'playlist' && (
              <section aria-label="Playlist">
                {offerCurrent && (
                  <button
                    type="button"
                    className="add-current"
                    onClick={() =>
                      save({
                        videoId: current.videoId,
                        title: current.info?.title ?? 'YouTube video',
                        author: current.info?.author ?? '',
                        duration: current.duration,
                      })
                    }
                  >
                    <Icon name="plus" size={18} weight="bold" />
                    <span>Add what’s playing{current.info ? `: ${current.info.title}` : ''}</span>
                  </button>
                )}
                {playlist.items.length > 0 ? (
                  <ul className="video-list">
                    {playlist.items.map((item) => (
                      <VideoRow
                        key={item.videoId}
                        video={item}
                        playing={item.videoId === current?.videoId}
                        onPlay={() => play(item.videoId)}
                        action={
                          <button
                            type="button"
                            className="row-action"
                            onClick={() => playlist.remove(item.videoId)}
                            aria-label={`Remove “${item.title}” from the playlist`}
                          >
                            <Icon name="close" size={17} weight="bold" />
                          </button>
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="sheet-tip">
                    {playlist.loaded
                      ? 'Nothing saved yet. Tap + beside any video to keep it here. You both see the same playlist, and when one video ends the next one starts.'
                      : 'Loading the playlist…'}
                  </p>
                )}
              </section>
            )}

            {tab === 'recent' && (
              <section aria-label="Watched before">
                {recents.length > 0 ? (
                  <ul className="video-list">
                    {recents.map((recent) => (
                      <VideoRow key={recent.videoId} video={recent} onPlay={() => play(recent.videoId)} action={saveToggle(recent)} />
                    ))}
                  </ul>
                ) : (
                  <p className="sheet-tip">Videos you watch on this phone show up here, so you can find them again.</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

type RowVideo = Pick<PlaylistItem, 'videoId' | 'title' | 'author'> & { duration?: number | null; live?: boolean };

function VideoRow({ video, playing, onPlay, action }: { video: RowVideo; playing?: boolean; onPlay(): void; action: ReactNode }) {
  const length = video.live ? 'LIVE' : video.duration ? formatTime(video.duration) : null;
  return (
    <li className={cx('video-row', playing && 'is-playing')}>
      <button type="button" className="video-row-main" onClick={onPlay}>
        <span className="thumb">
          <img src={thumbnailUrl(video.videoId)} alt="" loading="lazy" width="96" height="54" />
          {length && <span className={cx('thumb-length', video.live && 'live')}>{length}</span>}
        </span>
        <span className="video-row-text">
          <strong>{video.title || 'YouTube video'}</strong>
          <span>{playing ? 'Playing now' : video.author}</span>
        </span>
      </button>
      {action}
    </li>
  );
}
