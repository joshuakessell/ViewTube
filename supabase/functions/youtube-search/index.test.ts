import { describe, expect, it, vi } from 'vitest';
import { handle, parseDuration } from './index';

const env =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    values[name];
const PUBLIC_KEY = 'sb_publishable_0123456789abcdef';
const ENV = env({ YOUTUBE_API_KEY: 'yt-key', SUPABASE_PUBLISHABLE_KEYS: `{"default":"${PUBLIC_KEY}"}` });

const request = (query: string, key: string | null = PUBLIC_KEY) =>
  new Request(`https://x.test/functions/v1/youtube-search?q=${encodeURIComponent(query)}`, { headers: key ? { apikey: key } : {} });

/** Stands in for the two YouTube endpoints the function calls. */
function fakeYouTube() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(new Headers(init?.headers).get('X-Goog-Api-Key')).toBe('yt-key');
    expect(url.searchParams.has('key')).toBe(false);
    if (url.pathname.endsWith('/search')) {
      expect(url.searchParams.get('videoEmbeddable')).toBe('true');
      return Response.json({
        items: [
          { id: { videoId: 'aaaaaaaaaaa' }, snippet: { liveBroadcastContent: 'none' } },
          { id: { videoId: 'bbbbbbbbbbb' }, snippet: { liveBroadcastContent: 'live' } },
          { id: { videoId: 'ccccccccccc' }, snippet: { liveBroadcastContent: 'none' } }, // removed between the two calls
        ],
      });
    }
    expect(url.searchParams.get('id')).toBe('aaaaaaaaaaa,bbbbbbbbbbb,ccccccccccc');
    return Response.json({
      items: [
        { id: 'bbbbbbbbbbb', snippet: { title: 'Live now', channelTitle: 'Channel B' }, contentDetails: { duration: 'P0D' } },
        { id: 'aaaaaaaaaaa', snippet: { title: 'Tom & Jerry', channelTitle: 'Channel A' }, contentDetails: { duration: 'PT1H2M3S' } },
      ],
    });
  }) as unknown as typeof fetch;
}

describe('parseDuration', () => {
  it('reads YouTube lengths', () => {
    expect(parseDuration('PT4M13S')).toBe(253);
    expect(parseDuration('PT1H2M3S')).toBe(3723);
    expect(parseDuration('PT45S')).toBe(45);
    expect(parseDuration('P1DT1H')).toBe(90000);
    expect(parseDuration('P0D')).toBe(0);
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('soon')).toBeNull();
  });
});

describe('youtube-search', () => {
  it('returns results in search order with titles and lengths', async () => {
    const response = await handle(request('cats one'), ENV, fakeYouTube());
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.json()).toEqual({
      items: [
        { videoId: 'aaaaaaaaaaa', title: 'Tom & Jerry', author: 'Channel A', duration: 3723, live: false },
        { videoId: 'bbbbbbbbbbb', title: 'Live now', author: 'Channel B', duration: null, live: true },
      ],
    });
  });

  it('answers a repeated search without asking YouTube again', async () => {
    const youtube = fakeYouTube();
    await handle(request('cats two'), ENV, youtube);
    await handle(request('  Cats   TWO '), ENV, youtube);
    expect(youtube).toHaveBeenCalledTimes(2); // one search + one details call, once
  });

  it('turns away callers without the project key', async () => {
    const youtube = fakeYouTube();
    expect((await handle(request('cats three', null), ENV, youtube)).status).toBe(401);
    expect((await handle(request('cats three', 'sb_publishable_someone_elses_key'), ENV, youtube)).status).toBe(401);
    expect(youtube).not.toHaveBeenCalled();
  });

  it('says so when no YouTube key has been set', async () => {
    const response = await handle(request('cats four'), env({ SUPABASE_PUBLISHABLE_KEYS: PUBLIC_KEY }), fakeYouTube());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'not_configured' });
  });

  it('tells the app whether search is ready, without calling YouTube', async () => {
    const youtube = fakeYouTube();
    const ping = (values: Record<string, string>) =>
      handle(new Request('https://x.test/functions/v1/youtube-search?ping', { headers: { apikey: PUBLIC_KEY } }), env(values), youtube);
    expect(await (await ping({ YOUTUBE_API_KEY: 'yt-key', SUPABASE_PUBLISHABLE_KEYS: PUBLIC_KEY })).json()).toEqual({ ready: true });
    expect(await (await ping({ SUPABASE_PUBLISHABLE_KEYS: PUBLIC_KEY })).json()).toEqual({ ready: false });
    expect(youtube).not.toHaveBeenCalled();
  });

  it('reports the daily limit as such', async () => {
    const overQuota = (async () =>
      Response.json(
        { error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } },
        { status: 403 },
      )) as unknown as typeof fetch;
    const response = await handle(request('cats five'), ENV, overQuota);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'quota' });
  });

  it('answers the browser preflight and rejects empty searches', async () => {
    const preflight = await handle(new Request('https://x.test/', { method: 'OPTIONS' }), ENV, fakeYouTube());
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('apikey');
    expect((await handle(request(' '), ENV, fakeYouTube())).status).toBe(400);
  });
});
