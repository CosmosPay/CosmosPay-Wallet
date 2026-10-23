import { useRef } from 'react';

/** How far a finger must travel sideways, and how much more than it travels down. */
const MIN_DX = 48;
const DOMINANCE = 1.4;

/**
 * Horizontal swipe on a panel: `onLeft` when the finger moves left (show the next panel),
 * `onRight` when it moves right. A gesture that is mostly vertical is a scroll and is left
 * alone — the panel lives inside the screen's own scroller, and stealing its scrolls would
 * make the page impossible to move.
 *
 * Pointer events, so a mouse drag on a desktop works the same as a finger.
 */
export function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: { clientX: number; clientY: number; pointerType: string }) => {
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: { clientX: number; clientY: number }) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;
      if (dx < 0) onLeft();
      else onRight();
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}
