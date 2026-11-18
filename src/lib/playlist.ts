import { HAS_SIGNALING } from '../config';
import { supabase } from './supabaseClient';

/** One saved video. The playlist belongs to the room, so both people see and edit the same one. */
export interface PlaylistItem {
  videoId: string;
  title: string;
  author: string;
  /** Seconds, when known. */
  duration: number | null;
  addedBy: string;
}

interface PlaylistStore {
  list(room: string): Promise<PlaylistItem[]>;
  add(room: string, item: PlaylistItem): Promise<void>;
  remove(room: string, videoId: string): Promise<void>;
}

interface Row {
  video_id: string;
  title: string;
  author: string;
  duration: number | null;
  added_by: string;
}

/**
 * Kept in the Supabase project, behind three database functions that each
 * take the room code. (The table itself can't be read: listing it would
 * reveal everyone's room codes.)
 */
const remote: PlaylistStore = {
  async list(room) {
    const { data, error } = await supabase().rpc('playlist_list', { p_room: room });
    if (error) throw error;
    return ((data ?? []) as Row[]).map((row) => ({
      videoId: row.video_id,
      title: row.title,
      author: row.author,
      duration: row.duration,
      addedBy: row.added_by,
    }));
  },
  async add(room, item) {
    const { error } = await supabase().rpc('playlist_add', {
      p_room: room,
      p_video_id: item.videoId,
      p_title: item.title,
      p_author: item.author,
      p_duration: item.duration === null ? null : Math.round(item.duration),
      p_added_by: item.addedBy,
    });
    if (error) throw error;
  },
  async remove(room, videoId) {
    const { error } = await supabase().rpc('playlist_remove', { p_room: room, p_video_id: videoId });
    if (error) throw error;
  },
};

/** Dev fallback when Supabase isn't configured: this browser's storage, which its tabs share. */
const local: PlaylistStore = (() => {
  const key = (room: string) => `viewtube.playlist.${room}`;
  const read = (room: string): PlaylistItem[] => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key(room)) ?? '[]');
      return Array.isArray(stored) ? (stored as PlaylistItem[]) : [];
    } catch {
      return [];
    }
  };
  const write = (room: string, items: PlaylistItem[]) => localStorage.setItem(key(room), JSON.stringify(items));
  return {
    list: async (room) => read(room),
    add: async (room, item) => {
      const items = read(room);
      if (!items.some((existing) => existing.videoId === item.videoId)) write(room, [...items, item]);
    },
    remove: async (room, videoId) =>
      write(
        room,
        read(room).filter((item) => item.videoId !== videoId),
      ),
  };
})();

export const playlistStore: PlaylistStore = HAS_SIGNALING ? remote : local;
