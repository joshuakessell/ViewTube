import type { SignalPayload } from './transport';

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface CallOptions {
  /** Exactly one side must be polite; it yields when both make an offer at once. */
  polite: boolean;
  iceServers: RTCIceServer[];
  local: MediaStream | null;
  sendSignal(signal: SignalPayload): void;
  onStatus(status: CallStatus): void;
  onRemoteStream(stream: MediaStream): void;
}

const MAX_AUTO_RESTARTS = 3;
/** Keep the camera feed modest so it doesn't fight YouTube for bandwidth. */
const VIDEO_MAX_BITRATE = 700_000;

/**
 * One peer-to-peer audio/video connection, using the WebRTC "perfect
 * negotiation" pattern so either side can (re)negotiate at any time.
 */
export class Call {
  private readonly pc: RTCPeerConnection;
  private makingOffer = false;
  private ignoreOffer = false;
  private closed = false;
  private restarts = 0;
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
    // Whoever has no mic/camera still needs to receive. Only the impolite side
    // adds these (its offer always wins), so the two sides can't both create
    // unmatched receive-only lines.
    if (!opts.polite) {
      for (const kind of ['audio', 'video'] as const) {
        if (!sending.has(kind)) pc.addTransceiver(kind, { direction: 'recvonly' });
      }
    }

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) opts.sendSignal({ description: pc.localDescription.toJSON() });
      } catch (err) {
        console.warn('[call] offer failed', err);
      } finally {
        this.makingOffer = false;
      }
    };

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

  /** Feed in a description or candidates received from the other side. */
  handleSignal(signal: SignalPayload): void {
    // Strictly one at a time: candidates must be added after their description.
    this.queue = this.queue.then(() => this.process(signal)).catch((err) => console.warn('[call] signal failed', err));
  }

  /** Try to re-establish the connection, e.g. after switching networks. */
  retry(): void {
    if (this.closed) return;
    this.restarts = 0;
    this.opts.onStatus('reconnecting');
    this.pc.restartIce();
  }

  /** Nudge a connection that might be dead without resetting the retry budget. */
  checkConnection(): void {
    if (this.closed) return;
    const state = this.pc.connectionState;
    if (state === 'disconnected' || state === 'failed') this.pc.restartIce();
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

  private async process({ description, candidates }: SignalPayload): Promise<void> {
    if (this.closed) return;
    const pc = this.pc;
    if (description) {
      const collision = description.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
      this.ignoreOffer = !this.opts.polite && collision;
      if (this.ignoreOffer) return;
      await pc.setRemoteDescription(description); // rolls back our own offer if we are polite
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        if (pc.localDescription) this.opts.sendSignal({ description: pc.localDescription.toJSON() });
      }
    }
    for (const candidate of candidates ?? []) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        if (!this.ignoreOffer) console.warn('[call] bad candidate', err);
      }
    }
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
        // Often recovers on its own within a few seconds; if not, restart ICE.
        this.opts.onStatus('reconnecting');
        this.disconnectTimer = setTimeout(() => {
          if (!this.closed && pc.connectionState === 'disconnected') pc.restartIce();
        }, 4000);
        break;
      case 'failed':
        if (this.restarts < MAX_AUTO_RESTARTS) {
          this.restarts += 1;
          this.opts.onStatus('reconnecting');
          pc.restartIce();
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
