import { useEffect, useState, type RefObject } from 'react';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

const DRAG_START_PX = 8;

/**
 * Lets a floating tile be dragged around its positioned parent and dropped
 * into the nearest corner, the way the small picture in a phone call works.
 * The caller positions the element from the returned corner; while a finger
 * is down this hook moves it with a transform.
 *
 * A press that doesn't travel stays an ordinary tap, so a tile can be both
 * draggable and tappable.
 */
export function useCornerDrag(ref: RefObject<HTMLElement | null>, enabled: boolean, initial: Corner): Corner {
  const [corner, setCorner] = useState<Corner>(initial);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let pointer: number | null = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let swallowClick = false;
    let frame = 0;

    const onDown = (event: PointerEvent) => {
      if (pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
      pointer = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dragging = false;
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        dragging = true;
        el.setPointerCapture(event.pointerId);
        el.classList.add('dragging');
      }
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px) scale(1.03)`;
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      // The tap that ends a drag must not also count as a tap on the tile.
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 60);

      const parent = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
      const before = el.getBoundingClientRect();
      if (!parent) {
        el.style.transform = '';
        el.style.transition = '';
        return;
      }
      const centerX = before.left + before.width / 2 - parent.left;
      const centerY = before.top + before.height / 2 - parent.top;
      const next = `${centerY < parent.height / 2 ? 't' : 'b'}${centerX < parent.width / 2 ? 'l' : 'r'}` as Corner;

      // Move to the new corner at once, offset back to where the finger let
      // go, then let that offset animate away.
      el.dataset.corner = next;
      el.style.transform = '';
      const after = el.getBoundingClientRect();
      el.style.transform = `translate(${before.left - after.left}px, ${before.top - after.top}px)`;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.transition = '';
        el.style.transform = '';
      });
      setCorner(next);
    };

    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClick, true);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('click', onClick, true);
      el.classList.remove('dragging');
      el.style.transform = '';
      el.style.transition = '';
    };
  }, [ref, enabled]);

  return corner;
}
