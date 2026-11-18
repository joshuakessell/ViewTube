import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from '../config';

let client: SupabaseClient | null = null;

/** The one connection to the Supabase project. Only call when `HAS_SIGNALING` is true. */
export function supabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Call setup sends a short burst (offer, answer, candidates, pings).
    realtime: { params: { eventsPerSecond: 40 } },
  });
  return client;
}
