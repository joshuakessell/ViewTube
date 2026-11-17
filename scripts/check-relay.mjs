// Confirms the relay configured in .env.production really carries a message
// from one client to another, the way the two phones use it.
//   npm run check:relay
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.production', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => /^\w+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
);

const connect = () =>
  createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const topic = `viewtube:relay-check-${Date.now()}`;

function join(client, onMessage) {
  return new Promise((resolve, reject) => {
    const channel = client.channel(topic, { config: { broadcast: { self: false, ack: false } } });
    channel.on('broadcast', { event: 'msg' }, ({ payload }) => onMessage(payload));
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') resolve(channel);
      else if (status !== 'CLOSED') reject(new Error(`could not join the channel: ${status} ${err?.message ?? ''}`));
    });
  });
}

const timer = setTimeout(() => {
  console.error('Relay check failed: no message arrived within 20 seconds.');
  process.exit(1);
}, 20_000);

try {
  let deliver;
  const arrived = new Promise((resolve) => (deliver = resolve));
  await join(connect(), deliver);
  const sender = await join(connect(), () => {});
  const sentAt = Date.now();
  await sender.send({ type: 'broadcast', event: 'msg', payload: { t: 'check', sentAt } });
  const payload = await arrived;
  clearTimeout(timer);
  console.log(`Relay OK: message crossed in ${Date.now() - payload.sentAt} ms via ${new URL(env.VITE_SUPABASE_URL).host}`);
  process.exit(0);
} catch (err) {
  clearTimeout(timer);
  console.error(`Relay check failed: ${err.message}`);
  process.exit(1);
}
