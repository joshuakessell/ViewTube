import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PS, type PlayerAdapter } from './player';
import { PlaybackSync, type Playback } from './playbackSync';

/** Behaves like the YouTube iframe player as far as the sync logic can tell. */
class FakePlayer implements PlayerAdapter {
  state: number = PS.CUED;
  videoId = '';
  rate = 1;
  duration = 600;
  /** iOS before the first tap: scripts can't start playback. */
  blocked = false;
  onState: (state: number) => void = () => {};
  private pos = 0;
  private since = Date.now();

  private set(state: number): void {
    this.pos = this.getTime();
    this.since = Date.now();
    if (state === this.state) return;
    this.state = state;
    this.onState(state);
  }

  load(videoId: string, start: number): void {
    this.videoId = videoId;
    this.pos = start;
    this.since = Date.now();
    this.state = PS.UNSTARTED;
    this.onState(PS.UNSTARTED);
    if (!this.blocked) this.set(PS.PLAYING);
  }

  cue(videoId: string, start: number): void {
    this.videoId = videoId;
    this.pos = start;
    this.since = Date.now();
    this.state = PS.CUED;
    this.onState(PS.CUED);
  }

  play(): void {
    if (this.blocked) return;
    this.set(PS.PLAYING);
  }

  pause(): void {
    this.set(PS.PAUSED);
  }

  seek(seconds: number): void {
    this.pos = seconds;
    this.since = Date.now();
  }

  setRate(rate: number): void {
    this.pos = this.getTime();
    this.since = Date.now();
    this.rate = rate;
  }

  getTime(): number {
    return this.state === PS.PLAYING ? this.pos + ((Date.now() - this.since) / 1000) * this.rate : this.pos;
  }

  getDuration(): number {
    return this.duration;
  }

  getState(): number {
    return this.state;
  }

  getRate(): number {
    return this.rate;
  }

  // What a person does with YouTube's own controls inside the iframe:
  tapPlay(): void {
    this.blocked = false;
    this.set(PS.PLAYING);
  }

  tapPause(): void {
    this.set(PS.PAUSED);
  }

  scrubTo(seconds: number): void {
    this.seek(seconds);
  }

  /** The network stalls: time stops, then playback resumes on its own. */
  stall(ms: number): void {
    this.set(PS.BUFFERING);
    setTimeout(() => this.set(PS.PLAYING), ms);
  }
}

interface Device {
  sync: PlaybackSync;
  player: FakePlayer;
  sent: Playback[];
}

/** Two phones wired to each other, with a little network delay. */
function pair(delayMs = 50): { a: Device; b: Device } {
  const make = (id: string, other: () => Device): Device => {
    const sent: Playback[] = [];
    const player = new FakePlayer();
    const sync = new PlaybackSync({
      selfId: id,
      peerOffset: () => 0,
      onChange: () => {},
      isHidden: () => false,
      send: (state) => {
        sent.push(state);
        setTimeout(() => other().sync.applyRemote(state), delayMs);
      },
    });
    player.onState = sync.onPlayerState;
    return { sync, player, sent };
  };
  const a: Device = make('a', () => b);
  const b: Device = make('b', () => a);
  return { a, b };
}

const VIDEO = 'dQw4w9WgXcQ';

/** Both phones have the video cued and their players attached. */
function watching(delayMs = 50) {
  const devices = pair(delayMs);
  const { a, b } = devices;
  a.sync.setVideo(VIDEO);
  vi.advanceTimersByTime(200);
  for (const device of [a, b]) {
    const cue = device.sync.initialCue()!;
    device.player.cue(cue.videoId, cue.start);
    device.sync.attachPlayer(device.player, cue.videoId, cue.start);
  }
  vi.advanceTimersByTime(2000);
  return devices;
}

const apart = (a: Device, b: Device) => Math.abs(a.player.getTime() - b.player.getTime());

describe('PlaybackSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cues a pasted video on both phones without starting it', () => {
    const { a, b } = watching();
    expect(b.sync.getPlayback().videoId).toBe(VIDEO);
    expect(a.player.state).toBe(PS.CUED);
    expect(b.player.state).toBe(PS.CUED);
  });

  it('starts both when one taps play inside the YouTube player', () => {
    const { a, b } = watching();
    a.player.tapPlay();
    vi.advanceTimersByTime(5000);
    expect(b.player.state).toBe(PS.PLAYING);
    expect(apart(a, b)).toBeLessThan(0.5);
    // One message for the play; the other phone obeying it must not echo back.
    expect(a.sent).toHaveLength(2); // setVideo + play
    expect(b.sent).toHaveLength(0);
  });

  it('pauses both when one pauses inside the YouTube player', () => {
    const { a, b } = watching();
    a.player.tapPlay();
    vi.advanceTimersByTime(10_000);
    b.player.tapPause();
    vi.advanceTimersByTime(2000);
    expect(a.player.state).toBe(PS.PAUSED);
    expect(a.sync.getPlayback().playing).toBe(false);
    expect(apart(a, b)).toBeLessThan(0.5);
  });

  it('follows a scrub made inside the YouTube player', () => {
    const { a, b } = watching();
    a.player.tapPlay();
    vi.advanceTimersByTime(10_000);
    a.player.scrubTo(300);
    vi.advanceTimersByTime(3000);
    expect(b.player.getTime()).toBeGreaterThan(299);
    expect(apart(a, b)).toBeLessThan(0.8);
    expect(b.player.state).toBe(PS.PLAYING);
  });

  it('follows a scrub made while paused', () => {
    const { a, b } = watching();
    a.player.tapPlay();
    vi.advanceTimersByTime(5000);
    a.player.tapPause();
    vi.advanceTimersByTime(3000);
    a.player.scrubTo(120);
    vi.advanceTimersByTime(3000);
    expect(b.player.getTime()).toBeCloseTo(120, 0);
    expect(b.player.state).toBe(PS.PAUSED);
  });

  it('drives both from our own transport controls', () => {
    const { a, b } = watching();
    a.player.tapPlay();
    vi.advanceTimersByTime(4000);
    b.sync.pause();
    vi.advanceTimersByTime(2000);
    expect(a.player.state).toBe(PS.PAUSED);
    b.sync.seek(200);
    vi.advanceTimersByTime(2000);
    expect(a.player.getTime()).toBeCloseTo(200, 0);
    a.sync.play();
    vi.advanceTimersByTime(3000);
    expect(b.player.state).toBe(PS.PLAYING);
    expect(apart(a, b)).toBeLessThan(0.5);
  });

  it('asks for a tap when the browser blocks scripted playback, then catches up quietly', () => {
    const { a, b } = watching();
    b.player.blocked = true; // an iPhone that has not been tapped yet
    a.player.tapPlay();
    vi.advanceTimersByTime(3000);
    expect(b.player.state).not.toBe(PS.PLAYING);
    expect(b.sync.getView().needsTap).toBe(true);

    vi.advanceTimersByTime(20_000);
    const sentBefore = b.sent.length;
    b.player.tapPlay();
    vi.advanceTimersByTime(3000);
    expect(b.sync.getView().needsTap).toBe(false);
    expect(apart(a, b)).toBeLessThan(0.8);
    expect(a.player.getTime()).toBeGreaterThan(25); // the first phone was not dragged back
    expect(b.sent.length).toBe(sentBefore); // catching up is not a change to announce
  });

  it('catches up after a stall instead of dragging the other phone back', () => {
    const { a, b } = watching();
    a.player.tapPlay();
    vi.advanceTimersByTime(10_000);
    const sentBefore = b.sent.length;
    b.player.stall(6000);
    vi.advanceTimersByTime(12_000);
    expect(apart(a, b)).toBeLessThan(0.8);
    expect(a.player.getTime()).toBeGreaterThan(21);
    expect(b.sent.length).toBe(sentBefore);
  });

  it('keeps the other phone playing when one is in the background', () => {
    const sentA: Playback[] = [];
    const player = new FakePlayer();
    let hidden = false;
    const sync = new PlaybackSync({
      selfId: 'a',
      peerOffset: () => 0,
      onChange: () => {},
      isHidden: () => hidden,
      send: (state) => sentA.push(state),
    });
    player.onState = sync.onPlayerState;
    sync.setVideo(VIDEO);
    player.cue(VIDEO, 0);
    sync.attachPlayer(player, VIDEO, 0);
    vi.advanceTimersByTime(2000);
    player.tapPlay();
    vi.advanceTimersByTime(5000);
    const sentBefore = sentA.length;

    hidden = true;
    player.tapPause(); // what the OS does to a video in a hidden page
    vi.advanceTimersByTime(8000);
    expect(sync.getPlayback().playing).toBe(true);
    expect(sentA.length).toBe(sentBefore);

    hidden = false;
    sync.resync();
    vi.advanceTimersByTime(2000);
    expect(player.state).toBe(PS.PLAYING);
    expect(player.getTime()).toBeGreaterThan(14); // jumped ahead to where the room is
  });

  it('switches both to a new video', () => {
    const { a, b } = watching();
    a.player.tapPlay();
    vi.advanceTimersByTime(5000);
    b.sync.setVideo('aaaaaaaaaaa', 30);
    vi.advanceTimersByTime(2000);
    expect(a.player.videoId).toBe('aaaaaaaaaaa');
    expect(a.sync.getPlayback().playing).toBe(false);
    expect(a.sync.expected()).toBe(30);
  });

  it('carries straight on into the next video of a playlist, on both phones', () => {
    const { a, b } = watching();
    a.player.tapPlay();
    vi.advanceTimersByTime(3000);

    a.sync.setVideo('aqz-KE-bpKQ', 0, true);
    vi.advanceTimersByTime(4000);
    for (const device of [a, b]) {
      expect(device.player.videoId).toBe('aqz-KE-bpKQ');
      expect(device.player.state).toBe(PS.PLAYING);
      expect(device.sync.getPlayback().playing).toBe(true);
    }
    expect(Math.abs(a.player.getTime() - b.player.getTime())).toBeLessThan(0.5);
    expect(a.player.getTime()).toBeGreaterThan(3);
  });

  it('settles on one state when both act at the same moment', () => {
    const { a, b } = watching(200);
    a.player.tapPlay();
    vi.advanceTimersByTime(5000);
    a.sync.seek(100);
    b.sync.seek(400);
    vi.advanceTimersByTime(5000);
    expect(a.sync.getPlayback().rev).toBe(b.sync.getPlayback().rev);
    expect(a.sync.getPlayback().by).toBe(b.sync.getPlayback().by);
    expect(apart(a, b)).toBeLessThan(0.8);
  });

  it('accounts for the other phone’s clock being off', () => {
    let offset = 0;
    const player = new FakePlayer();
    const sync = new PlaybackSync({
      selfId: 'a',
      peerOffset: () => offset,
      onChange: () => {},
      isHidden: () => false,
      send: () => {},
    });
    player.onState = sync.onPlayerState;
    offset = 90_000; // their clock is a minute and a half ahead of ours
    // "Playing, was at 10s" stamped 2 real seconds ago on their clock.
    sync.applyRemote({ videoId: VIDEO, playing: true, position: 10, rate: 1, at: Date.now() + offset - 2000, rev: 5, by: 'b' });
    expect(sync.expected()).toBeCloseTo(12, 1);
    // Passing it on converts the timestamp to our clock.
    expect(sync.wire().at).toBe(Date.now() - 2000);
  });
});
