import { useEffect, useState } from 'react';
import { SEARCH_URL, SUPABASE_KEY } from '../config';

export interface FoundVideo {
  videoId: string;
  title: string;
  author: string;
  /** Seconds, when known. */
  duration: number | null;
  live: boolean;
}

const headers = SUPABASE_KEY ? { apikey: SUPABASE_KEY } : undefined;

// Search only works once a YouTube key has been given to the search function,
// so the app asks before offering it. The last answer is remembered, so that
// search doesn't pop in a moment after the screen appears.
const REMEMBERED = 'viewtube.search';

function recallReady(): boolean {
  try {
    return localStorage.getItem(REMEMBERED) === '1';
  } catch {
    return false;
  }
}

let asked: Promise<boolean> | null = null;

function askReady(): Promise<boolean> {
  if (!SEARCH_URL) return Promise.resolve(false);
  asked ??= fetch(`${SEARCH_URL}?ping`, { headers })
    .then((response) => (response.ok ? (response.json() as Promise<{ ready?: unknown }>) : null))
    .then((body) => {
      const ready = body?.ready === true;
      try {
        localStorage.setItem(REMEMBERED, ready ? '1' : '0');
      } catch {
        // not remembered, that's all
      }
      return ready;
    })
    .catch(() => {
      asked = null; // offline: go by last time, and ask again next time
      return recallReady();
    });
  return asked;
}

/** Whether YouTube can be searched from here, as opposed to only pasting links. */
export function useCanSearch(): boolean {
  const [can, setCan] = useState(() => SEARCH_URL !== null && recallReady());
  useEffect(() => {
    let current = true;
    void askReady().then((ready) => {
      if (current) setCan(ready);
    });
    return () => {
      current = false;
    };
  }, []);
  return can;
}

export type SearchProblem = 'limit' | 'off' | 'failed';

export class SearchError extends Error {
  constructor(readonly problem: SearchProblem) {
    super(problem);
  }
}

const SESSION_CACHE_MAX = 40;
const seen = new Map<string, FoundVideo[]>();

function isFound(value: unknown): value is FoundVideo {
  const item = value as FoundVideo | null;
  return typeof item?.videoId === 'string' && typeof item.title === 'string' && typeof item.author === 'string';
}

/** Searches YouTube through the project's search function (which holds the YouTube key). */
export async function searchYouTube(query: string, signal?: AbortSignal): Promise<FoundVideo[]> {
  if (!SEARCH_URL) throw new SearchError('off');
  const wanted = query.trim().replace(/\s+/g, ' ');
  const cacheKey = wanted.toLowerCase();
  const cached = seen.get(cacheKey);
  if (cached) return cached;

  let response: Response;
  try {
    response = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(wanted)}`, { headers, signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new SearchError('failed'); // offline
  }
  if (response.status === 429) throw new SearchError('limit');
  if (response.status === 503) throw new SearchError('off');
  if (!response.ok) throw new SearchError('failed');

  const body = (await response.json().catch(() => null)) as { items?: unknown } | null;
  const items = Array.isArray(body?.items) ? body.items.filter(isFound) : [];
  if (seen.size >= SESSION_CACHE_MAX) seen.clear();
  seen.set(cacheKey, items);
  return items;
}
