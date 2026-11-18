// Searches YouTube for the app.
//
// This runs on Supabase rather than in the page so that the YouTube API key
// stays on the server: the key is the function secret YOUTUBE_API_KEY and is
// never sent to a browser.
//
// GET /functions/v1/youtube-search?q=...  ->  { items: Found[] }
// GET /functions/v1/youtube-search?ping   ->  { ready: boolean }   (has a key been set?)
//
// One search costs 101 of the 10,000 units a YouTube API key gets per day
// (100 for the search, 1 to look up titles and lengths), so about 99 a day.

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

interface Found {
  videoId: string;
  title: string;
  author: string;
  /** Seconds; null for a live stream. */
  duration: number | null;
  live: boolean;
}

interface SearchResponse {
  items?: { id?: { videoId?: string }; snippet?: { liveBroadcastContent?: string } }[];
}

interface VideosResponse {
  items?: { id: string; snippet?: { title?: string; channelTitle?: string }; contentDetails?: { duration?: string } }[];
}

const API = 'https://www.googleapis.com/youtube/v3';
const MAX_RESULTS = 12;
const CACHE_MS = 15 * 60 * 1000;
const CACHE_MAX = 300;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** The same search again within a quarter of an hour costs nothing. */
const cache = new Map<string, { at: number; items: Found[] }>();

class YouTubeError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** "PT1H2M3S" -> 3723 */
export function parseDuration(iso: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m || iso === 'P') return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

async function youtube<T>(path: string, params: Record<string, string>, key: string, fetcher: typeof fetch): Promise<T> {
  // The key travels in a header, not the address, so it can't end up in a log of URLs.
  const response = await fetcher(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { 'X-Goog-Api-Key': key } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error;
    throw new YouTubeError(response.status, error?.errors?.[0]?.reason ?? '', error?.message ?? `HTTP ${response.status}`);
  }
  return body as T;
}

async function search(query: string, key: string, fetcher: typeof fetch): Promise<Found[]> {
  const found = await youtube<SearchResponse>(
    'search',
    {
      part: 'snippet',
      type: 'video',
      videoEmbeddable: 'true', // skip videos whose owners don't allow them to play outside YouTube
      maxResults: String(MAX_RESULTS),
      q: query,
      fields: 'items(id/videoId,snippet/liveBroadcastContent)',
    },
    key,
    fetcher,
  );
  const hits = (found.items ?? []).filter((item) => /^[\w-]{11}$/.test(item.id?.videoId ?? ''));
  if (hits.length === 0) return [];
  const live = new Set(hits.filter((item) => item.snippet?.liveBroadcastContent === 'live').map((item) => item.id!.videoId!));
  const ids = hits.map((item) => item.id!.videoId!);

  // Search results carry HTML-escaped titles and no lengths; this second, cheap call has both.
  const details = await youtube<VideosResponse>(
    'videos',
    { part: 'snippet,contentDetails', id: ids.join(','), fields: 'items(id,snippet(title,channelTitle),contentDetails/duration)' },
    key,
    fetcher,
  );
  const byId = new Map((details.items ?? []).map((video) => [video.id, video]));
  return ids.flatMap((id) => {
    const video = byId.get(id);
    if (!video) return [];
    const isLive = live.has(id);
    return [
      {
        videoId: id,
        title: video.snippet?.title ?? '',
        author: video.snippet?.channelTitle ?? '',
        duration: isLive ? null : parseDuration(video.contentDetails?.duration ?? ''),
        live: isLive,
      },
    ];
  });
}

export async function handle(
  req: Request,
  env: (name: string) => string | undefined,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return reply(405, { error: 'method' });

  // Only the app should be calling this. It identifies itself with the
  // project's public key, which is all a page can hold; this keeps out
  // passers-by, not a determined visitor, and what it protects is a free
  // daily search allowance.
  const projectKeys = [env('SUPABASE_PUBLISHABLE_KEYS'), env('SUPABASE_ANON_KEY')].filter(Boolean).join('\n');
  const caller = req.headers.get('apikey') ?? '';
  if (projectKeys && (caller.length < 20 || !projectKeys.includes(caller))) return reply(401, { error: 'unauthorized' });

  const params = new URL(req.url).searchParams;
  const key = env('YOUTUBE_API_KEY');
  // Lets the app decide whether to offer search at all, without spending any allowance.
  if (params.has('ping')) return reply(200, { ready: Boolean(key) }, { 'Cache-Control': 'no-store' });

  const query = (params.get('q') ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (query.length < 2) return reply(400, { error: 'query' });
  if (!key) return reply(503, { error: 'not_configured' });

  const cacheable = { 'Cache-Control': 'public, max-age=600' };
  const cacheKey = query.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && now() - cached.at < CACHE_MS) return reply(200, { items: cached.items }, cacheable);

  try {
    const items = await search(query, key, fetcher);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(cacheKey, { at: now(), items });
    return reply(200, { items }, cacheable);
  } catch (err) {
    if (err instanceof YouTubeError) {
      if (/quota|limitExceeded/i.test(err.reason)) return reply(429, { error: 'quota' });
      // e.g. the key is wrong, or the YouTube Data API isn't enabled for it
      console.error(`YouTube API refused the request: ${err.status} ${err.reason} ${err.message}`);
      return reply(502, { error: 'youtube', reason: err.reason });
    }
    console.error('YouTube API could not be reached', err);
    return reply(502, { error: 'unreachable' });
  }
}

if (typeof Deno !== 'undefined') Deno.serve((req) => handle(req, (name) => Deno.env.get(name)));
