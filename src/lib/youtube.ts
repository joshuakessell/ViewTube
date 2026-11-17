import type { PlayerAdapter } from './player';

export interface ParsedVideo {
  videoId: string;
  /** Start offset in seconds, from a `t=` / `start=` parameter. */
  start: number;
}

const ID_RE = /^[\w-]{11}$/;

function parseStart(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function fromUrl(url: URL): ParsedVideo | null {
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})(?:[/?]|$)/)?.[1] ?? null;
  }
  if (!id || !ID_RE.test(id)) return null;
  const hashT = url.hash.match(/[#&]t=([\w]+)/)?.[1] ?? null;
  const start = parseStart(url.searchParams.get('t') ?? url.searchParams.get('start') ?? hashT);
  return { videoId: id, start };
}

/**
 * Pulls a YouTube video out of whatever was pasted or shared: a full link, a
 * short link, a bare 11-character id, or share text with a link inside it.
 */
export function parseYouTubeUrl(input: string): ParsedVideo | null {
  const text = input.trim();
  if (!text) return null;
  if (ID_RE.test(text)) return { videoId: text, start: 0 };

  const candidates: string[] = text.match(/https?:\/\/\S+/gi) ?? [];
  if (candidates.length === 0 && /^[\w.-]+\.[a-z]{2,}\//i.test(text)) candidates.push(`https://${text}`);

  for (const candidate of candidates) {
    try {
      const parsed = fromUrl(new URL(candidate));
      if (parsed) return parsed;
    } catch {
      // not a URL, keep looking
    }
  }
  return null;
}

// --- IFrame Player API ------------------------------------------------------

interface YTEvent {
  data: number;
}

interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      width?: string;
      height?: string;
      videoId?: string;
      playerVars?: Record<string, string | number | undefined>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: YTEvent) => void;
        onPlaybackRateChange?: (e: YTEvent) => void;
        onError?: (e: YTEvent) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      script.remove();
      reject(new Error('Could not load the YouTube player'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export interface YouTubeHandlers {
  onReady(player: PlayerAdapter): void;
  onState(state: number): void;
  onRate(rate: number): void;
  onError(code: number): void;
  onLoadFailed(): void;
}

/**
 * Creates the YouTube iframe inside `host`, with `initial` cued up (not
 * playing). Returns a function that tears it down again.
 *
 * The iframe must stay where it is in the DOM for its whole life: moving an
 * iframe reloads it, which would restart the video.
 */
export function mountYouTubePlayer(host: HTMLElement, initial: ParsedVideo, on: YouTubeHandlers): () => void {
  let disposed = false;
  let player: YTPlayer | null = null;
  const mount = document.createElement('div');
  host.appendChild(mount);

  loadYouTubeApi()
    .then((YT) => {
      if (disposed) return;
      const created = new YT.Player(mount, {
        width: '100%',
        height: '100%',
        videoId: initial.videoId,
        playerVars: {
          playsinline: 1, // stay in the page on iPhone instead of the native fullscreen player
          controls: 1,
          fs: 0, // we provide our own fullscreen that keeps the call audible
          rel: 0,
          enablejsapi: 1,
          origin: window.location.origin,
          start: initial.start >= 1 ? Math.floor(initial.start) : undefined,
        },
        events: {
          onReady: () => {
            if (disposed) return;
            on.onReady({
              load: (videoId, start) => created.loadVideoById({ videoId, startSeconds: start }),
              cue: (videoId, start) => created.cueVideoById({ videoId, startSeconds: start }),
              play: () => created.playVideo(),
              pause: () => created.pauseVideo(),
              seek: (seconds) => created.seekTo(seconds, true),
              setRate: (rate) => created.setPlaybackRate(rate),
              getTime: () => num(created.getCurrentTime?.()),
              getDuration: () => num(created.getDuration?.()),
              getState: () => created.getPlayerState?.() ?? -1,
              getRate: () => num(created.getPlaybackRate?.()) || 1,
            });
          },
          onStateChange: (e) => !disposed && on.onState(e.data),
          onPlaybackRateChange: (e) => !disposed && on.onRate(e.data),
          onError: (e) => !disposed && on.onError(e.data),
        },
      });
      player = created;
    })
    .catch(() => {
      if (!disposed) on.onLoadFailed();
    });

  return () => {
    disposed = true;
    try {
      player?.destroy();
    } catch {
      // the iframe may already be gone
    }
    host.replaceChildren();
  };
}
