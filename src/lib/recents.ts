/** Videos watched on this phone lately, so they can be picked again without hunting for the link. */
export interface Recent {
  videoId: string;
  title: string;
  author: string;
}

const KEY = 'viewtube.recents';
const MAX = 10;

function isRecent(value: unknown): value is Recent {
  const item = value as Recent | null;
  return typeof item?.videoId === 'string' && typeof item.title === 'string' && typeof item.author === 'string';
}

export function listRecents(): Recent[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter(isRecent).slice(0, MAX) : [];
  } catch {
    return []; // private browsing, or something else wrote there
  }
}

export function addRecent(recent: Recent): void {
  try {
    const rest = listRecents().filter((item) => item.videoId !== recent.videoId);
    localStorage.setItem(KEY, JSON.stringify([recent, ...rest].slice(0, MAX)));
  } catch {
    // not remembered, that's all
  }
}
