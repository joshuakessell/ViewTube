import { HAS_SIGNALING } from '../config';
import type { Playback } from './playbackSync';
import { supabase } from './supabaseClient';

export interface SignalPayload {
  description?: RTCSessionDescriptionInit;
  candidates?: RTCIceCandidateInit[];
  /** From the answering side: please restart the connection. */
  restart?: boolean;
}

interface Presence {
  from: string;
  name: string;
  mic: boolean;
  cam: boolean;
}

/** Everything the two devices say to each other outside the call itself. */
export type Msg =
  | ({ t: 'hello' } & Presence)
  | ({ t: 'welcome'; to: string; sid: number; playback: Playback } & Presence)
  | { t: 'bye'; from: string }
  /** Sent to a third device: the room already has its two people. */
  | { t: 'full'; from: string; to: string }
  | { t: 'signal'; from: string; to: string; sid: number; signal: SignalPayload }
  | { t: 'ping'; from: string; to: string; sid: number; t0: number; rev: number; by: string }
  | { t: 'pong'; from: string; to: string; t0: number; t1: number }
  | { t: 'playback'; from: string; state: Playback }
  | { t: 'media'; from: string; mic: boolean; cam: boolean }
  /** "I changed the room's playlist": the other device re-reads it. */
  | { t: 'playlist'; from: string };

export interface Transport {
  send(msg: Msg): void;
  close(): void;
}

export interface TransportHandlers {
  /** Fires every time the channel (re)connects. */
  onOpen(): void;
  onClose(): void;
  onMessage(msg: Msg): void;
}

/** A Supabase Realtime broadcast channel: a relay both phones can reach. */
function openSupabaseTransport(room: string, handlers: TransportHandlers): Transport {
  const channel = supabase().channel(`viewtube:${room}`, {
    config: { broadcast: { self: false, ack: false } },
  });
  channel.on('broadcast', { event: 'msg' }, ({ payload }) => handlers.onMessage(payload as Msg));
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') handlers.onOpen();
    else handlers.onClose();
  });
  return {
    send: (msg) => {
      channel.send({ type: 'broadcast', event: 'msg', payload: msg }).catch(() => {
        // dropped while offline; hello/ping retries cover it
      });
    },
    close: () => {
      void supabase().removeChannel(channel);
    },
  };
}

/** Dev fallback when Supabase isn't configured: only reaches tabs of this browser. */
function openLocalTransport(room: string, handlers: TransportHandlers): Transport {
  const channel = new BroadcastChannel(`viewtube:${room}`);
  let open = true;
  channel.onmessage = (event) => handlers.onMessage(event.data as Msg);
  setTimeout(() => open && handlers.onOpen(), 0);
  return {
    send: (msg) => {
      if (open) channel.postMessage(msg);
    },
    close: () => {
      open = false;
      channel.close();
    },
  };
}

export function openTransport(room: string, handlers: TransportHandlers): Transport {
  return HAS_SIGNALING ? openSupabaseTransport(room, handlers) : openLocalTransport(room, handlers);
}
