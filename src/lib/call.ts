import type { SignalPayload } from './transport';

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface CallOptions {
  /**
   * Exactly one side is the caller. Only the caller ever makes offers; the
   * other side only answers, and asks the caller when it wants a restart.
   *
   * (Letting both sides offer and resolving the collision by rolling one offer
   * back is the textbook alternative, but a rollback that lands right after
   * the offer leaves Chromium gathering no network candidates at all, and the
   * call never connects.)
   */
  caller: boolean;
  iceServers: RTCIceServer[];
  local: MediaStream | null;
  sendSignal(signal: SignalPayload): void;
  onStatus(status: CallStatus): void;
  onRemoteStream(stream: MediaStream): void;
}

const MAX_AUTO_RESTARTS = 3;
const RESTART_MIN_GAP_MS = 3000;
/** Keep the camera feed modest so it doesn't fight YouTube for bandwidth. */
const VIDEO_MAX_BITRATE = 700_000;

/** One peer-to-peer audio/video connection. */
export class Call {
  private readonly pc: RTCPeerConnection;
  private closed = false;
  private restarts = 0;
  private lastRestart = 0;
  private queue: Promise<void> = Promise.resolve();
  private pending: RTCIceCandidateInit[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private remoteIds = '';

  constructor(private readonly opts: CallOptions) {
    const pc = (this.pc = new RTCPeerConnection({ iceServers: opts.iceServers }));

    const sending = new Set<string>();
    opts.local?.getTracks().forEach((track) => {
      pc.addTrack(track, opts.local!);
      sending.add(track.kind);
    });

    if (opts.caller) {
      // The offer has to ask for audio and video even if we have no mic or
      // camera of our own to send.
      for (const kind of ['audio', 'video'] as const) {
        if (!sending.has(kind)) pc.addTransceiver(kind, { direction: 'recvonly' });
      }
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription();
          if (!this.closed && pc.localDescription) opts.sendSignal({ description: pc.localDescription.toJSON() });
        } catch (err) {
          console.warn('[call] offer failed', err);
        }
      };
    }
    // The answering side adds its tracks above and they are matched to the
    // caller's offer when it arrives; it never needs to offer.

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      // Candidates arrive in a burst; send them as one message.
      this.pending.push(candidate.toJSON());
      this.flushTimer ??= setTimeout(() => this.flushCandidates(), 150);
    };

    pc.ontrack = ({ track }) => {
      track.onunmute = () => this.emitRemote();
      this.emitRemote();
    };

    pc.onconnectionstatechange = () => this.onConnectionState();
  }

  /** Feed in something received from the other side. */
  handleSignal(signal: SignalPayload): void {
    // Strictly one at a time: candidates must be added after their description.
    this.queue = this.queue.then(() => this.process(signal)).catch((err) => console.warn('[call] signal failed', err));
  }

  /** The user asked to try again after the call gave up. */
  retry(): void {
    if (this.closed) return;
    this.restarts = 0;
    this.opts.onStatus('reconnecting');
    this.restart();
  }

  /** Nudge a connection that might be dead, e.g. after switching networks. */
  checkConnection(): void {
    if (this.closed) return;
    const state = this.pc.connectionState;
    if (state === 'disconnected' || state === 'failed') this.restart();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.flushTimer);
    clearTimeout(this.disconnectTimer);
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
  }

  private async process({ description, candidates, restart }: SignalPayload): Promise<void> {
    if (this.closed) return;
    const pc = this.pc;

    if (restart && this.opts.caller) this.restart();

    if (description) {
      // Offers only travel caller -> answerer, answers the other way.
      if ((description.type === 'offer') === this.opts.caller) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        if (!this.closed && pc.localDescription) this.opts.sendSignal({ description: pc.localDescription.toJSON() });
      }
    }

    for (const candidate of candidates ?? []) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('[call] bad candidate', err);
      }
    }
  }

  /** Find a new network path, keeping the same connection. */
  private restart(): void {
    const now = Date.now();
    if (now - this.lastRestart < RESTART_MIN_GAP_MS) return; // both sides usually notice at once
    this.lastRestart = now;
    if (this.opts.caller) this.pc.restartIce(); // leads to a fresh offer
    else this.opts.sendSignal({ restart: true });
  }

  private flushCandidates(): void {
    this.flushTimer = undefined;
    if (this.closed || this.pending.length === 0) return;
    this.opts.sendSignal({ candidates: this.pending });
    this.pending = [];
  }

  private emitRemote(): void {
    const tracks = this.pc
      .getReceivers()
      .map((receiver) => receiver.track)
      .filter((track) => track && track.readyState === 'live');
    const ids = tracks.map((track) => track.id).join(',');
    if (ids === this.remoteIds) return;
    this.remoteIds = ids;
    // A fresh MediaStream each time: Safari doesn't reliably pick up tracks
    // added to a stream that is already attached to a <video>.
    this.opts.onRemoteStream(new MediaStream(tracks));
  }

  private onConnectionState(): void {
    if (this.closed) return;
    const pc = this.pc;
    clearTimeout(this.disconnectTimer);
    switch (pc.connectionState) {
      case 'connected':
        this.restarts = 0;
        this.opts.onStatus('connected');
        void this.capVideoBitrate();
        break;
      case 'disconnected':
        // Often recovers on its own within a few seconds; if not, restart.
        this.opts.onStatus('reconnecting');
        this.disconnectTimer = setTimeout(() => {
          if (!this.closed && pc.connectionState === 'disconnected') this.restart();
        }, 4000);
        break;
      case 'failed':
        if (this.restarts < MAX_AUTO_RESTARTS) {
          this.restarts += 1;
          this.opts.onStatus('reconnecting');
          this.restart();
        } else {
          this.opts.onStatus('failed');
        }
        break;
      case 'new':
      case 'connecting':
        this.opts.onStatus(this.restarts > 0 ? 'reconnecting' : 'connecting');
        break;
      default:
        break;
    }
  }

  private async capVideoBitrate(): Promise<void> {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE;
      await sender.setParameters(params);
    } catch {
      // purely an optimisation
    }
  }
}
