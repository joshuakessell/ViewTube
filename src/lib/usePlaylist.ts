import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playlistStore, type PlaylistItem } from './playlist';

export interface Playlist {
  items: PlaylistItem[];
  /** False until the first load has come back. */
  loaded: boolean;
  has(videoId: string): boolean;
  add(item: PlaylistItem): void;
  remove(videoId: string): void;
}

interface Options {
  room: string;
  /** Changes whenever the other person says they edited the playlist. */
  changedElsewhere: number;
  /** Tell the other person we edited it. */
  announce(): void;
  onProblem(message: string): void;
}

/**
 * The room's playlist. Edits show at once and are then saved; the saved copy
 * is re-read after every edit, whenever the other person edits, and when the
 * app comes back to the foreground.
 */
export function usePlaylist({ room, changedElsewhere, announce, onProblem }: Options): Playlist {
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Counts loads and edits, so an answer that was overtaken by something newer is dropped.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const fresh = await playlistStore.list(room);
      if (mine !== latest.current) return;
      setItems(fresh);
      setLoaded(true);
    } catch {
      // offline, most likely: keep showing what we have and try again on the next occasion
    }
  }, [room]);

  useEffect(() => {
    void reload();
  }, [reload, changedElsewhere]);

  useEffect(() => {
    const onReturn = () => {
      if (!document.hidden) void reload();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('online', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('online', onReturn);
    };
  }, [reload]);

  const save = useCallback(
    async (change: Promise<void>, failure: string) => {
      try {
        await change;
        announce();
      } catch {
        onProblem(failure);
      }
      await reload();
    },
    [announce, onProblem, reload],
  );

  const add = useCallback(
    (item: PlaylistItem) => {
      latest.current += 1;
      setItems((current) => (current.some((existing) => existing.videoId === item.videoId) ? current : [...current, item]));
      void save(playlistStore.add(room, item), 'Couldn’t save that to the playlist');
    },
    [room, save],
  );

  const remove = useCallback(
    (videoId: string) => {
      latest.current += 1;
      setItems((current) => current.filter((item) => item.videoId !== videoId));
      void save(playlistStore.remove(room, videoId), 'Couldn’t remove that from the playlist');
    },
    [room, save],
  );

  return useMemo(
    () => ({ items, loaded, add, remove, has: (videoId: string) => items.some((item) => item.videoId === videoId) }),
    [items, loaded, add, remove],
  );
}
