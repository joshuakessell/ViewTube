import { useEffect, useState } from 'react';

export interface VideoInfo {
  title: string;
  author: string;
}

const known = new Map<string, VideoInfo | null>();
const loading = new Map<string, Promise<VideoInfo | null>>();

/** A small 16:9 still of the video, with no black bars. */
export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/** Title and channel, from YouTube's public oEmbed endpoint. Null if it can't be had. */
export function fetchVideoInfo(videoId: string): Promise<VideoInfo | null> {
  if (known.has(videoId)) return Promise.resolve(known.get(videoId) ?? null);
  let request = loading.get(videoId);
  if (!request) {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    request = fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { title?: unknown; author_name?: unknown } | null) => {
        const info =
          data && typeof data.title === 'string'
            ? { title: data.title, author: typeof data.author_name === 'string' ? data.author_name : '' }
            : null;
        known.set(videoId, info);
        return info;
      })
      .catch(() => null) // offline or blocked: the app works without titles
      .finally(() => loading.delete(videoId));
    loading.set(videoId, request);
  }
  return request;
}

export function useVideoInfo(videoId: string | null): VideoInfo | null {
  const [info, setInfo] = useState<{ id: string; info: VideoInfo } | null>(null);

  useEffect(() => {
    if (!videoId) return;
    let current = true;
    void fetchVideoInfo(videoId).then((found) => {
      if (current && found) setInfo({ id: videoId, info: found });
    });
    return () => {
      current = false;
    };
  }, [videoId]);

  return info && info.id === videoId ? info.info : null;
}
