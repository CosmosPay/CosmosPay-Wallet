import type { PointerEvent } from 'react';

/**
 * Pointer handler for the `.ink` hover fill (src/styles/animations.css), the button hover
 * of snap.cosmospay.lat. Put it on both `onPointerEnter` and `onPointerLeave`: it centres
 * the ink circle on the pointer and sizes it to reach the farthest corner from there, so
 * the fill grows from the entry point and shrinks back to the exit point.
 *
 * It writes custom properties on the element at runtime, the way src/lib/viewport.ts does
 * for the keyboard inset — no `style` prop in JSX, and the paint itself stays in CSS.
 */
export function moveInk(event: PointerEvent<HTMLElement>): void {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
  el.style.setProperty('--ink-x', `${x}px`);
  el.style.setProperty('--ink-y', `${y}px`);
  el.style.setProperty('--ink-size', `${2 * radius}px`);
}

/** Spread onto an `.ink` control: `<button className="ink" {...inkHandlers} />`. */
export const inkHandlers = { onPointerEnter: moveInk, onPointerLeave: moveInk } as const;
