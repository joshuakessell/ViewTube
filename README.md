# ViewTube

Watch a YouTube video with one other person, in sync, while on a video call with them. A web app, so it runs on iPhone (Safari) and Android (Chrome) from the same link and can be added to the home screen.

- Search YouTube, paste a link, or pick something you watched before, and it is cued for both of you. Play, pause and seeking apply to both.
- Each room has a playlist that both people see and edit. Save a video with the + beside it (or the Playlist chip under the one playing); when a playlist video ends, the next one starts for both.
- The video and the call share the screen. With the video in front, the two of you sit side by side beneath it; tap the call and it takes over the screen with the video as a small tile you can drag to any corner. Tap the smaller one to swap back.
- Either one can go full screen. The other keeps running underneath, so you still hear it.

## Run it

```bash
npm install
npm run dev
```

With no configuration, two tabs of the same browser on the same room code connect to each other, which is enough to develop against. Two different devices need the relay below.

```bash
npm test        # sync logic and link parsing
npm run build   # type-check and build to dist/
```

## Configuration

The deployed build reads `.env.production`, which is committed. For local development against the real relay, copy it to `.env.local`.

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` | A Supabase project URL and its publishable key. The two devices find each other and exchange play/pause/seek through a Realtime broadcast channel. No tables are used. |
| `VITE_SEARCH_URL` | Optional. Where searches are sent; defaults to the `youtube-search` function of the Supabase project above. |
| `VITE_ICE_SERVERS` | Optional JSON array of ICE servers. Defaults to public STUN, which is enough on most home Wi-Fi. Add a TURN server if the call fails to connect on mobile data. |

The page has to be served over HTTPS for the camera and microphone to work (localhost is exempt).

## The Supabase side

Besides the Realtime channel, the project holds two things, both kept in `supabase/` here:

- **The playlist** (`supabase/migrations/`): one table, reachable only through the functions `playlist_list`, `playlist_add` and `playlist_remove`, each of which takes the room code. The table itself is closed to the public key, because listing it would list everyone's room codes.
- **Search** (`supabase/functions/youtube-search/`): an Edge Function that calls the YouTube Data API, so that the API key stays on the server. It reads the key from the function secret `YOUTUBE_API_KEY` (Supabase dashboard: Edge Functions, Secrets). Until that secret exists the app hides search and offers pasting a link only. A YouTube API key allows about 99 searches a day; repeats of a recent search are answered from memory and don't count.

Neither is deployed by the GitHub workflow. After changing them, apply the SQL to the project and redeploy the function (`supabase functions deploy youtube-search --no-verify-jwt`; the function checks the caller's key itself, because the platform's own check doesn't accept publishable keys).

## Deploying

Every push to `main` builds the app and publishes it to GitHub Pages (`.github/workflows/deploy.yml`). The same workflow runs `npm run check:relay`, which sends a message between two clients through the configured relay.

## How it works

- `src/lib/playbackSync.ts` holds the shared state ("playing, was at 42s at time T") and drives the local YouTube player to match it. It also notices when someone uses YouTube's own controls inside the player and turns that into a shared change.
- `src/lib/call.ts` is the peer-to-peer audio/video connection (WebRTC).
- `src/lib/roomSession.ts` ties the two together: finding the other person, reconnecting, estimating the clock difference between the devices.
- `src/lib/transport.ts` is the relay: Supabase Realtime, or a `BroadcastChannel` when unconfigured.
- `src/lib/playlist.ts` and `usePlaylist.ts` are the room's playlist: saved in Supabase (or in the browser when unconfigured), re-read whenever the other person says they changed it.
- `src/lib/search.ts` asks the search function, and first asks it whether search is set up at all.
- `src/components/Room.tsx` is the screen, with `VideoPane`, `CallPane`, `NowPlaying` (the shared remote) and `VideoPicker` (search, paste, playlist) beside it. The two panes never move in the DOM (moving the YouTube iframe would reload it); swapping only changes which grid area each one occupies, and the browser's view transitions animate the change where they exist.

## Look and feel

All of it lives in `src/styles.css`: the colours, type and spacing are variables at the top. The glow behind the room is a blurred still of the current video. Typefaces (Fraunces for the few headlines, Figtree for everything else) and icons (Phosphor) are bundled, not fetched from a font service.

- `public/icon.svg` is the app icon; the PNG icons are renders of it.
- `public/og.jpg` is the picture shown when an invite link is sent in a message. `index.html` points at it by its full address, so change that if the site moves.

## Things to know

- Rooms are for two people. A third device is told the room is full.
- The first time a video plays on an iPhone, iOS requires a tap on the video itself; the app asks for it. After that, play and pause from either phone work.
- Videos whose owners disable embedding can't be played here.
- Headphones avoid the other person hearing the video twice through your microphone.
