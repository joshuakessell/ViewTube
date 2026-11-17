import { useState } from 'react';
import { Lobby, type Joined } from './components/Lobby';
import { Room } from './components/Room';
import { stopMedia } from './lib/media';
import { parseYouTubeUrl, type ParsedVideo } from './lib/youtube';

/**
 * On Android the installed app shows up in the share sheet, so "Share" in the
 * YouTube app can open us with the link in the query string.
 */
function readSharedVideo(): ParsedVideo | null {
  const params = new URLSearchParams(window.location.search);
  for (const key of ['url', 'text', 'title']) {
    const video = parseYouTubeUrl(params.get(key) ?? '');
    if (video) return video;
  }
  return null;
}

export function App() {
  const [joined, setJoined] = useState<Joined | null>(null);
  const [sharedVideo, setSharedVideo] = useState(readSharedVideo);

  if (!joined) return <Lobby hasSharedVideo={sharedVideo !== null} onJoin={setJoined} />;

  return (
    <Room
      key={joined.room}
      joined={joined}
      initialVideo={sharedVideo}
      onInitialVideoUsed={() => setSharedVideo(null)}
      onLeave={() => {
        stopMedia(joined.stream);
        setJoined(null);
      }}
    />
  );
}
