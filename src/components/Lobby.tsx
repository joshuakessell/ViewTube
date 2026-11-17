import { useState, type FormEvent } from 'react';
import { HAS_SIGNALING } from '../config';
import { getLocalMedia } from '../lib/media';
import { generateRoomCode, normalizeRoomCode } from '../lib/roomCode';

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

function initialRoom(): string {
  const invited = normalizeRoomCode(new URLSearchParams(window.location.search).get('room') ?? '');
  return invited || recall('viewtube.room') || generateRoomCode();
}

export function Lobby({ hasSharedVideo, onJoin }: { hasSharedVideo: boolean; onJoin(joined: Joined): void }) {
  const [name, setName] = useState(() => recall('viewtube.name') ?? '');
  const [room, setRoom] = useState(initialRoom);
  const [busy, setBusy] = useState(false);

  async function join(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const code = normalizeRoomCode(room) || generateRoomCode();
    const who = name.trim() || 'Guest';
    setBusy(true);
    const media = await getLocalMedia();
    remember('viewtube.name', who);
    remember('viewtube.room', code);
    // Keep the room in the address bar so the page can be shared or bookmarked as-is.
    window.history.replaceState(null, '', `?room=${encodeURIComponent(code)}`);
    onJoin({ room: code, name: who, stream: media.stream, problem: media.problem });
  }

  return (
    <main className="lobby">
      <form className="lobby-card" onSubmit={join}>
        <div className="brand">
          <img src="./icon.svg" alt="" width="52" height="52" />
          <div>
            <h1>ViewTube</h1>
            <p>Watch YouTube together, face to face.</p>
          </div>
        </div>

        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Zak"
            maxLength={24}
            autoComplete="given-name"
            enterKeyHint="next"
          />
        </label>

        <label className="field">
          <span>Room</span>
          <div className="field-row">
            <input
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
            <button type="button" className="btn" onClick={() => setRoom(generateRoomCode())}>
              New
            </button>
          </div>
          <small>You both join the same room. It’s remembered on this phone after the first time.</small>
        </label>

        <button type="submit" className="btn primary big" disabled={busy}>
          {busy ? 'Starting camera…' : 'Join with camera & mic'}
        </button>

        {hasSharedVideo && <p className="lobby-note">The video you shared will be cued up once you’re in.</p>}
        {!HAS_SIGNALING && (
          <p className="lobby-note warn">
            Demo mode: no relay is configured, so this only connects tabs within this one browser.
          </p>
        )}
      </form>
    </main>
  );
}
