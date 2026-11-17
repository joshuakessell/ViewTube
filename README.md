# ViewTube

Watch a YouTube video with one other person, in sync, while on a video call with them. A web app, so it runs on iPhone (Safari) and Android (Chrome) from the same link and can be added to the home screen.

- Paste a YouTube link and it is cued for both of you. Play, pause and seeking apply to both.
- The video and the call share the screen: one in front, the other as a side tile. Tap the side tile to swap them.
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

Copy `.env.example` to `.env.local` (or `.env.production` for a deployed build).

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` | A Supabase project URL and its publishable key. The two devices find each other and exchange play/pause/seek through a Realtime broadcast channel. No tables are used. |
| `VITE_ICE_SERVERS` | Optional JSON array of ICE servers. Defaults to public STUN, which is enough on most home Wi-Fi. Add a TURN server if the call fails to connect on mobile data. |

The page has to be served over HTTPS for the camera and microphone to work (localhost is exempt).

## How it works

- `src/lib/playbackSync.ts` holds the shared state ("playing, was at 42s at time T") and drives the local YouTube player to match it. It also notices when someone uses YouTube's own controls inside the player and turns that into a shared change.
- `src/lib/call.ts` is the peer-to-peer audio/video connection (WebRTC).
- `src/lib/roomSession.ts` ties the two together: finding the other person, reconnecting, estimating the clock difference between the devices.
- `src/lib/transport.ts` is the relay: Supabase Realtime, or a `BroadcastChannel` when unconfigured.
- `src/components/Room.tsx` is the screen. The two panes never move in the DOM (moving the YouTube iframe would reload it); swapping only changes which grid area each one occupies.

## Things to know

- Rooms are for two people. A third device is told the room is full.
- The first time a video plays on an iPhone, iOS requires a tap on the video itself; the app asks for it. After that, play and pause from either phone work.
- Videos whose owners disable embedding can't be played here.
- Headphones avoid the other person hearing the video twice through your microphone.
