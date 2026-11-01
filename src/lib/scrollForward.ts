import { SCROLL_ARROW_PX, SCROLL_SMOOTH_MIN_PX, WHEEL_LINE_PX } from '@/constants/ui';

/**
 * Scroll the screen from anywhere in the window (the user's call: it must scroll whatever the
 * pointer is over). The screen's own column (`.screen`) is the one scroller in the app, and
 * on a desktop window it is a 480px column in a wide window: a wheel over the margin beside
 * it, or over the brand panel (`app/AuthAside.tsx`), found nothing to scroll. `Shell` sends
 * those here, along with the scroll keys when no control has the focus.
 *
 * Left alone: whatever already scrolls by itself — the screen, a list with room to move —
 * anything inside a dialog or a dropdown (the screen behind a modal does not move), and a
 * pinch or ctrl+wheel, which is the browser's zoom.
 */

/** The screen being shown: the last `.screen` under `root` (two overlap mid-transition). */
export function activeScreen(root: ParentNode): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>('.screen');
  return all.length ? all[all.length - 1] : null;
}

/** A wheel's vertical delta in pixels, whatever unit it came in. */
export function wheelPixels(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, pageHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * WHEEL_LINE_PX;
  if (e.deltaMode === 2) return e.deltaY * pageHeight;
  return e.deltaY;
}

const MODAL = 'dialog, [role="dialog"], [aria-modal="true"]';

/** Something between `from` and `stop` that can scroll `dy` itself. */
function scrollsItself(from: Element | null, stop: Element, dy: number): boolean {
  for (let el = from; el && el !== stop; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight) return true;
  }
  return false;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function scrollScreen(screen: HTMLElement, dy: number): void {
  const smooth = Math.abs(dy) >= SCROLL_SMOOTH_MIN_PX && !reducedMotion();
  screen.scrollBy({ top: dy, behavior: smooth ? 'smooth' : 'auto' });
}

/** A wheel anywhere in the window that nothing else takes scrolls the screen under `root`. */
export function forwardWheel(e: WheelEvent, root: HTMLElement): void {
  if (e.ctrlKey || e.deltaY === 0) return;
  const target = e.target instanceof Element ? e.target : null;
  if (!target || target.closest('.screen') || target.closest(MODAL)) return;
  const screen = activeScreen(root);
  if (!screen) return;
  const dy = wheelPixels(e, screen.clientHeight);
  if (scrollsItself(target, document.documentElement, dy)) return;
  scrollScreen(screen, dy);
}

/** The keys that scroll a page, as a distance (`Infinity`: to the end). Null for any other. */
export function scrollKeyDistance(key: string, shift: boolean, pageHeight: number): number | null {
  const page = pageHeight * 0.9;
  switch (key) {
    case 'ArrowDown':
      return SCROLL_ARROW_PX;
    case 'ArrowUp':
      return -SCROLL_ARROW_PX;
    case 'PageDown':
      return page;
    case 'PageUp':
      return -page;
    case ' ':
      return shift ? -page : page;
    case 'End':
      return Infinity;
    case 'Home':
      return -Infinity;
    default:
      return null;
  }
}

/**
 * The scroll keys, while the focus is on nothing that answers them — the page itself, or the
 * screen's own background. A field, a button, a radio group keep their keys.
 */
export function forwardScrollKey(e: KeyboardEvent, root: HTMLElement): void {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const focused = document.activeElement;
  if (focused && focused !== document.body && !focused.classList.contains('screen')) return;
  if (document.querySelector('dialog[open]')) return;
  const screen = activeScreen(root);
  if (!screen) return;
  const dy = scrollKeyDistance(e.key, e.shiftKey, screen.clientHeight);
  if (dy === null) return;
  e.preventDefault();
  if (Number.isFinite(dy)) return scrollScreen(screen, dy);
  screen.scrollTo({ top: dy > 0 ? screen.scrollHeight : 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
}
