/** YouTube player states, as reported by the IFrame API. */
export const PS = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/**
 * The slice of the YouTube player that the sync logic drives. Kept as an
 * interface so the sync logic can be tested against a fake player.
 */
export interface PlayerAdapter {
  /** Load a video and start playing it. */
  load(videoId: string, start: number): void;
  /** Load a video but leave it on its thumbnail, not playing. */
  cue(videoId: string, start: number): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  getTime(): number;
  getDuration(): number;
  getState(): number;
  getRate(): number;
}
