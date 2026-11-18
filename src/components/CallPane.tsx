import { useEffect, useRef, useState } from 'react';
import type { CallStatus } from '../lib/call';
import type { PeerInfo, RoomSnapshot } from '../lib/roomSession';
import { cx } from '../lib/ui';
import { useCornerDrag } from '../lib/useCornerDrag';
import { Icon } from './Icon';

type Tone = 'idle' | 'busy' | 'bad';

interface PeerStatus {
  text: string;
  tone: Tone;
}

function peerStatus(link: RoomSnapshot['link'], peer: PeerInfo | null, call: CallStatus): PeerStatus | null {
  if (!peer) {
    if (link === 'connecting') return { text: 'Opening the room…', tone: 'busy' };
    if (link === 'lost') return { text: 'Connection lost. Retrying…', tone: 'busy' };
    if (link === 'full') return { text: 'Two people are already in this room', tone: 'bad' };
    return { text: 'Nobody else is here yet', tone: 'idle' };
  }
  switch (call) {
    case 'connected':
      return null;
    case 'reconnecting':
      return { text: 'Reconnecting…', tone: 'busy' };
    case 'failed':
      return { text: 'The call couldn’t connect', tone: 'bad' };
    default:
      return { text: `Connecting to ${peer.name}…`, tone: 'busy' };
  }
}

const initial = (name: string): string => name.trim().slice(0, 1).toUpperCase() || '?';

interface CallPaneProps {
  snap: RoomSnapshot;
  local: MediaStream | null;
  selfName: string;
  isFront: boolean;
  onBringFront(): void;
  onRetry(): void;
  onInvite(): void;
}

export function CallPane({ snap, local, selfName, isFront, onBringFront, onRetry, onInvite }: CallPaneProps) {
  const { peer, remoteStream, call, link } = snap;
  const remoteRef = useRef<HTMLVideoElement>(null);
  const selfRef = useRef<HTMLVideoElement>(null);
  const selfTileRef = useRef<HTMLDivElement>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  // In front, your own picture is a small tile over theirs that can be dragged to another corner.
  const corner = useCornerDrag(selfTileRef, isFront, 'br');

  useEffect(() => {
    const el = remoteRef.current;
    if (!el) return;
    el.srcObject = remoteStream;
    if (!remoteStream) return;
    el.play().then(
      () => setSoundBlocked(false),
      // Only possible without a mic: with no capture running, browsers want a tap before playing sound.
      (err: unknown) => setSoundBlocked(err instanceof DOMException && err.name === 'NotAllowedError'),
    );
  }, [remoteStream]);

  useEffect(() => {
    const el = selfRef.current;
    if (!el) return;
    el.muted = true; // never play our own microphone back
    el.srcObject = local;
    if (local) el.play().catch(() => {});
  }, [local]);

  const unblockSound = () => {
    remoteRef.current?.play().then(
      () => setSoundBlocked(false),
      () => {},
    );
  };

  const status = peerStatus(link, peer, call);
  const seeThem = Boolean(peer?.cam && call === 'connected' && remoteStream?.getVideoTracks().length);
  const blocked = soundBlocked && remoteStream !== null && call !== 'failed';
  const canInvite = !peer && link === 'open';
  const action = call === 'failed' ? 'retry' : blocked ? 'sound' : canInvite ? 'invite' : null;

  return (
    <section className={cx('pane pane-call', isFront ? 'is-front' : 'duo')} aria-label="Video call">
      <div className="call-grid">
        <div className={cx('tile tile-peer', !peer && 'vacant')}>
          <video ref={remoteRef} className={cx('feed', !seeThem && 'hidden')} autoPlay playsInline />

          {!seeThem && (
            <div className={cx('tile-status', action && 'has-action')}>
              <div className={cx('avatar', status?.tone === 'busy' && 'pulsing', !peer && 'empty')} aria-hidden="true">
                {peer ? initial(peer.name) : <Icon name="invite" size={24} />}
              </div>
              <span className={cx('tile-status-text', status?.tone === 'bad' && 'bad')}>
                {status?.text ?? `${peer?.name ?? 'They'} turned their camera off`}
              </span>
            </div>
          )}

          {peer && (
            <div className="name-tag">
              <span>{peer.name}</span>
              {!peer.mic && <Icon name="micOff" size={14} weight="fill" />}
            </div>
          )}
          {seeThem && status && <div className="pane-banner">{status.text}</div>}
        </div>

        <div ref={selfTileRef} className="tile tile-self" data-corner={isFront ? corner : undefined}>
          <video ref={selfRef} className={cx('feed mirrored', !snap.cam && 'hidden')} autoPlay playsInline muted />
          {!snap.cam && (
            <div className="tile-status">
              <div className="avatar" aria-hidden="true">
                {initial(selfName)}
              </div>
            </div>
          )}
          {(!isFront || !snap.mic) && (
            <div className="name-tag">
              {!isFront && <span>You</span>}
              {!snap.mic && <Icon name="micOff" size={14} weight="fill" />}
            </div>
          )}
        </div>
      </div>

      {!isFront && <button type="button" className="pane-tap" onClick={onBringFront} aria-label="Bring the call to the front" />}

      {/* Buttons that belong to the other person's tile. Laid out on the same
          grid as the tiles, but above the tap layer so they stay usable while
          the call is the smaller pane. */}
      {action && (
        <div className="call-actions">
          <div className="call-actions-peer">
            {action === 'retry' && (
              <button type="button" className="btn small" onClick={onRetry}>
                Try again
              </button>
            )}
            {action === 'sound' && (
              <button type="button" className="btn small primary" onClick={unblockSound}>
                Tap to hear {peer?.name ?? 'them'}
              </button>
            )}
            {action === 'invite' && (
              <button type="button" className="btn small primary" onClick={onInvite}>
                <Icon name="share" size={17} weight="bold" />
                Invite
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
