import { useState, type FormEvent } from 'react';
import { HAS_SIGNALING } from '../config';
import { getLocalMedia } from '../lib/media';
import { generateRoomCode, inviteLink, normalizeRoomCode } from '../lib/roomCode';
import { Icon } from './Icon';

export interface Joined {
  room: string;
  name: string;
  stream: MediaStream | null;
  /** Why the camera/mic isn't fully available, if it isn't. */
  problem: string | null;
}

// Storage can throw in private browsing; the app works without it.
function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered, that's all
  }
}

/** Safari on an iPhone or iPad, not yet added to the home screen (where it runs without the browser bars). */
function couldBeInstalledOnIos(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

const invitedRoom = (): string => normalizeRoomCode(new URLSearchParams(window.location.search).get('room') ?? '');

export function Lobby({ hasSharedVideo, onJoin }: { hasSharedVideo: boolean; onJoin(joined: Joined): void }) {
  const [invited] = useState(invitedRoom);
  const [name, setName] = useState(() => recall('viewtube.name') ?? '');
  const [room, setRoom] = useState(() => invited || recall('viewtube.room') || generateRoomCode());
  const [editingRoom, setEditingRoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const code = () => normalizeRoomCode(room) || generateRoomCode();

  async function join(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const joining = code();
    const who = name.trim() || 'Guest';
    setBusy(true);
    const media = await getLocalMedia();
    remember('viewtube.name', who);
    remember('viewtube.room', joining);
    // Keep the room in the address bar so the page can be shared or bookmarked as-is.
    window.history.replaceState(null, '', `?room=${encodeURIComponent(joining)}`);
    onJoin({ room: joining, name: who, stream: media.stream, problem: media.problem });
  }

  // Sending the link first is the natural order: invite, then go in and wait.
  async function invite() {
    const inviting = code();
    setRoom(inviting);
    remember('viewtube.room', inviting);
    const url = inviteLink(inviting);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'ViewTube', text: 'Watch with me on ViewTube', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      // share sheet dismissed, or no clipboard: nothing to say
    }
  }

  return (
    <main className="lobby">
      <LobbyScene />

      <form className="lobby-panel" onSubmit={join}>
        <header className="lobby-brand">
          <h1 className="wordmark">ViewTube</h1>
          <p>Watch YouTube together, face to face.</p>
        </header>

        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Zak"
            maxLength={24}
            autoComplete="given-name"
            enterKeyHint="done"
          />
        </label>

        {editingRoom ? (
          <div className="field">
            <label htmlFor="room-code">Room</label>
            <div className="field-row">
              <input
                id="room-code"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                onBlur={() => setRoom((value) => normalizeRoomCode(value))}
                placeholder="Room code or invite link"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
              />
              <button
                type="button"
                className="icon-btn boxed"
                onClick={() => setRoom(generateRoomCode())}
                aria-label="Make a new room code"
                title="New code"
              >
                <Icon name="shuffle" size={20} />
              </button>
            </div>
            <small>Anyone who joins the same room is in the call with you.</small>
          </div>
        ) : (
          <div className="ticket">
            <div className="ticket-text">
              <span>{invited ? 'You’re invited to' : 'Your room'}</span>
              <strong>{room}</strong>
            </div>
            <button type="button" className="btn small" onClick={() => setEditingRoom(true)}>
              Change
            </button>
          </div>
        )}

        <div className="lobby-actions">
          <button type="submit" className="btn primary big" disabled={busy}>
            {busy ? 'Starting camera…' : 'Join the room'}
          </button>
          {!invited && (
            <button type="button" className="btn quiet" onClick={invite}>
              <Icon name="share" size={18} />
              {copied ? 'Link copied' : 'Send the invite link'}
            </button>
          )}
        </div>

        <p className="fineprint">
          {hasSharedVideo ? 'The video you shared will be cued up once you’re in. ' : ''}
          You’ll be asked for your camera and microphone.
        </p>
        {couldBeInstalledOnIos() && (
          <p className="fineprint">
            Tip: tap <Icon name="share" size={14} /> Share, then “Add to Home Screen”, and ViewTube opens full screen like an app.
          </p>
        )}
        {!HAS_SIGNALING && (
          <p className="fineprint warn">Demo mode: no relay is configured, so this only connects tabs within this one browser.</p>
        )}
      </form>
    </main>
  );
}

/** Two people on a couch in front of a glowing screen. */
function LobbyScene() {
  return (
    <div className="lobby-scene" aria-hidden="true">
      <svg viewBox="0 0 400 250" preserveAspectRatio="xMidYMax meet">
        <defs>
          <radialGradient id="scene-glow" cx="50%" cy="46%" r="50%">
            <stop offset="0" stopColor="#ff9a5c" stopOpacity="0.6" />
            <stop offset="0.55" stopColor="#ff7847" stopOpacity="0.15" />
            <stop offset="1" stopColor="#ff7847" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="scene-screen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffdcae" />
            <stop offset="0.5" stopColor="#ff8a52" />
            <stop offset="1" stopColor="#c63a6b" />
          </linearGradient>
          <radialGradient id="scene-shine" cx="26%" cy="16%" r="75%">
            <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="scene-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2c1d16" />
            <stop offset="0.5" stopColor="#130e0c" />
            <stop offset="1" stopColor="#0b0908" />
          </linearGradient>
          <linearGradient id="scene-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd9ad" stopOpacity="0.95" />
            <stop offset="0.28" stopColor="#ff7847" stopOpacity="0.3" />
            <stop offset="0.5" stopColor="#ff7847" stopOpacity="0" />
          </linearGradient>
        </defs>

        <ellipse className="scene-glow" cx="200" cy="96" rx="270" ry="160" fill="url(#scene-glow)" />

        <g className="scene-screen">
          <rect x="96" y="14" width="208" height="117" rx="14" fill="url(#scene-screen)" />
          <rect className="scene-shine" x="96" y="14" width="208" height="117" rx="14" fill="url(#scene-shine)" />
          <rect x="96.5" y="14.5" width="207" height="116" rx="13.5" fill="none" stroke="#fff" strokeOpacity="0.35" />
          <path
            d="M189 53v38l32-19z"
            fill="#2b1005"
            fillOpacity="0.82"
            stroke="#2b1005"
            strokeOpacity="0.82"
            strokeWidth="5"
            strokeLinejoin="round"
          />
        </g>

        <g fill="url(#scene-body)" stroke="url(#scene-rim)" strokeWidth="1.6">
          <circle cx="150" cy="146" r="26" />
          <path d="M100 250v-34c0-28 22-50 50-50s50 22 50 50v34z" />
          <circle cx="250" cy="142" r="28" />
          <path d="M196 250v-38c0-30 24-54 54-54s54 24 54 54v38z" />
          <path d="M40 250v-36c0-16 13-28 28-28h264c15 0 28 12 28 28v36z" />
          <path d="M6 250v-24c0-16 12-28 28-28s28 12 28 28v24z" />
          <path d="M338 250v-24c0-16 12-28 28-28s28 12 28 28v24z" />
        </g>
      </svg>
    </div>
  );
}
