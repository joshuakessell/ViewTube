const ADJECTIVES = [
  'amber', 'brave', 'calm', 'cosy', 'dusty', 'eager', 'fuzzy', 'gentle', 'happy', 'icy', 'jolly', 'kind',
  'lucky', 'mellow', 'nimble', 'odd', 'plucky', 'quiet', 'rusty', 'sunny', 'tidy', 'upbeat', 'velvet', 'witty',
  'young', 'zesty', 'bold', 'crisp', 'dapper', 'fancy', 'grand', 'humble',
];
const NOUNS = [
  'otter', 'badger', 'comet', 'dingo', 'ember', 'falcon', 'gecko', 'heron', 'ibis', 'jackal', 'koala', 'lemur',
  'marmot', 'newt', 'ocelot', 'panda', 'quokka', 'raven', 'sloth', 'tapir', 'urchin', 'viper', 'walrus', 'yak',
  'zebra', 'bison', 'crane', 'drake', 'finch', 'gopher', 'hare', 'lynx',
];

function pick<T>(list: readonly T[]): T {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return list[random[0] % list.length];
}

/** e.g. "mellow-otter-4821": easy to read out loud, hard to stumble into. */
export function generateRoomCode(): string {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const digits = String(random[0] % 10_000).padStart(4, '0');
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${digits}`;
}

/** Accepts a typed code or a pasted invite link and returns the bare code. */
export function normalizeRoomCode(input: string): string {
  let text = input.trim();
  try {
    const fromLink = new URL(text).searchParams.get('room');
    if (fromLink) text = fromLink;
  } catch {
    // not a link
  }
  return text
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function inviteLink(room: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', room);
  return url.toString();
}
