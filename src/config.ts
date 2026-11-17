const env = import.meta.env;

export const SUPABASE_URL: string | undefined = env.VITE_SUPABASE_URL || undefined;
export const SUPABASE_KEY: string | undefined = env.VITE_SUPABASE_KEY || undefined;

/** Without Supabase the app only connects tabs of the same browser (dev mode). */
export const HAS_SIGNALING = Boolean(SUPABASE_URL && SUPABASE_KEY);

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
];

function parseIceServers(raw: string | undefined): RTCIceServer[] {
  if (!raw) return DEFAULT_ICE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as RTCIceServer[];
  } catch {
    console.warn('VITE_ICE_SERVERS is not valid JSON; using the default STUN servers');
  }
  return DEFAULT_ICE;
}

export const ICE_SERVERS = parseIceServers(env.VITE_ICE_SERVERS);
