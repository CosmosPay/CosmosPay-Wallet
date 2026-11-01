import { useCallback, useRef, useState, type PointerEvent } from 'react';
import { WORD_DRAG_GLIDE_MS, WORD_DRAG_START_PX } from '@/constants/ui';

/**
 * Drag a word of the phrase check (`Verify.tsx`) to its gap — the gesture phone wallets use, so
 * the person learns it here. Pointer events, so a finger, a mouse and a pen all work the same;
 * a tap is still a tap (WCAG 2.5.7: dragging always has a single-pointer alternative).
 *
 * Where a word can land is marked in the DOM: `data-word-drop="<gap index>"` on a gap,
 * `data-word-drop="bank"` on the bank. The word under the pointer is a ghost element the
 * caller renders with `ghostRef`; it follows the pointer through custom properties written at
 * runtime (`--drag-x`, `--drag-y`), the way `lib/ink.ts` does — the paint stays in CSS.
 */

/** Where a dragged word comes from: a gap (its index) or the bank (null). */
export interface WordSource {
  word: string;
  from: number | null;
}

export type WordTarget = number | 'bank';

export interface WordDrag {
  source: WordSource;
  /** The place under the pointer that would take the word, if any. */
  over: WordTarget | null;
  /** Gliding into place, or back: no new drag until it lands. */
  settling: boolean;
}

interface Press {
  source: WordSource;
  pointerId: number;
  x0: number;
  y0: number;
  el: HTMLElement;
  dragging: boolean;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function centreOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function targetAt(x: number, y: number): { target: WordTarget; el: Element } | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-word-drop]');
  const raw = el?.getAttribute('data-word-drop');
  if (!el || raw == null) return null;
  if (raw === 'bank') return { target: 'bank', el };
  const index = Number(raw);
  return Number.isInteger(index) ? { target: index, el } : null;
}

export function useWordDrag(onDrop: (source: WordSource, to: WordTarget) => void) {
  const [drag, setDrag] = useState<WordDrag | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const over = useRef<{ target: WordTarget; el: Element } | null>(null);
  const settling = useRef(false);
  // A drag ends in a click on the element it started from; that click is not a tap.
  const swallowClick = useRef(false);

  const place = (x: number, y: number) => {
    ghostRef.current?.style.setProperty('--drag-x', `${x}px`);
    ghostRef.current?.style.setProperty('--drag-y', `${y}px`);
  };

  /** Glide the ghost to `to`, then run `done` and clear the drag. */
  const settle = useCallback((source: WordSource, to: { x: number; y: number }, done: () => void) => {
    settling.current = true;
    setDrag({ source, over: null, settling: true });
    const ms = reducedMotion() ? 0 : WORD_DRAG_GLIDE_MS;
    // A frame later, so the class that eases the move is on before the move.
    requestAnimationFrame(() => place(to.x, to.y));
    setTimeout(() => {
      done();
      setDrag(null);
      settling.current = false;
    }, ms + 16);
  }, []);

  const valid = (source: WordSource, to: WordTarget | undefined) =>
    to !== undefined && (to === 'bank' ? source.from !== null : to !== source.from);

  const end = useCallback(
    (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      press.current = null;
      if (!p.dragging) return; // a tap: the click that follows is the person's
      swallowClick.current = true;
      const hit = over.current;
      over.current = null;
      if (!cancelled && hit && valid(p.source, hit.target)) {
        settle(p.source, centreOf(hit.el), () => onDrop(p.source, hit.target));
      } else {
        settle(p.source, centreOf(p.el), () => undefined);
      }
    },
    [onDrop, settle],
  );

  /** Spread onto a word that can be dragged. */
  const handlers = (source: WordSource) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (settling.current || press.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      swallowClick.current = false;
      press.current = { source, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, el: e.currentTarget, dragging: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < WORD_DRAG_START_PX) return;
        p.dragging = true;
        setDrag({ source: p.source, over: null, settling: false });
      }
      place(e.clientX, e.clientY);
      const hit = targetAt(e.clientX, e.clientY);
      const next = hit && valid(p.source, hit.target) ? hit : null;
      if (next?.target !== over.current?.target) {
        over.current = next;
        setDrag({ source: p.source, over: next?.target ?? null, settling: false });
      }
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, false),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, true),
  });

  /** Wrap a tap handler: it does not run for the click a drag ends in. */
  const tap = (fn: () => void) => () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    fn();
  };

  return { drag, ghostRef, handlers, tap };
}
