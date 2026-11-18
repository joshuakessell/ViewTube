import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

export const cx = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ');

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Applies a layout change so that the pieces that move glide to their new
 * places instead of jumping. Browsers without view transitions (and people
 * who asked for less motion) simply get the change.
 */
export function morph(update: () => void): void {
  const canAnimate = typeof document.startViewTransition === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!canAnimate) {
    update();
    return;
  }
  // The browser photographs the page before and after this callback, so the
  // change has to be on screen by the time it returns.
  const transition = document.startViewTransition(() => flushSync(update));
  // A second change that arrives mid-glide cuts the first one short; that is fine.
  transition.ready.catch(() => {});
  transition.finished.catch(() => {});
}

/** A tiny tick of vibration on phones that have it (Android), for buttons that toggle something. */
export function buzz(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // not allowed here; it is only a nicety
  }
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
