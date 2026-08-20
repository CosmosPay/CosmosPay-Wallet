/**
 * Where the on-screen keyboard ends up, published to CSS as `--kb-h` on <html> plus a
 * `kb-open` class.
 *
 * Two engines answer the keyboard in two different ways and the app has to land in the
 * same place either way:
 *
 * - Android — Chrome with `interactive-widget=resizes-content`, and the Capacitor
 *   WebView, which the activity resizes — shrinks the LAYOUT viewport. `100dvh` shrinks
 *   with it, so `.shell-frame` already ends at the top of the keyboard and there is
 *   nothing to give back: `--kb-h` stays `0px` and only the class is set.
 * - iOS (WKWebView and Safari) shrinks only the VISUAL viewport. The frame still runs
 *   the full height of the screen, so its bottom — where every screen keeps its primary
 *   action — sits behind the keyboard. `--kb-h` is that overlap, and `.shell-content`
 *   subtracts it (src/styles/app/shell.css) so the scroll area ends where the keyboard
 *   begins.
 *
 * What this deliberately does NOT do is read every visual-viewport change as a keyboard.
 * iOS Safari collapses its own toolbars on scroll and pinch-zoom moves the same numbers;
 * either one would dock a button for no reason. A reading counts only while an editable
 * element holds focus, at scale 1, and past a threshold no toolbar reaches.
 *
 * The resting height is the other half of that: on Android it is the only evidence a
 * keyboard is up at all, and it cannot be sampled while typing, because that is exactly
 * when it is wrong. It tracks the tallest layout viewport seen since the last width
 * change (an orientation flip), and drops back only when nothing editable has focus.
 */

/** Below this a gap is a collapsing URL bar or a toolbar, not a keyboard. */
const MIN_KEYBOARD_PX = 96;

/** Pinch-zoom shrinks the visual viewport too — past this the reading means nothing. */
const MAX_SCALE = 1.05;

/** Long enough for a keyboard dismissal to finish before the geometry is re-read. */
const SETTLE_MS = 350;

/** Set on <html> while a keyboard is up, whichever way the engine reported it. */
const KB_OPEN_CLASS = 'kb-open';

/** The footer a screen docks above the keyboard — see `.kb-dock` in src/styles/app.css. */
const DOCK_CLASS = 'kb-dock';

/** Clearance left around a field that had to be scrolled back into view. */
const REVEAL_MARGIN_PX = 12;

/** Input types that raise no keyboard — a range or a checkbox must not dock anything. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Does this element bring the keyboard up? */
function isEditable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
}

/** The scroll container a field lives in — `.screen`, in every case the app has. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.scrollHeight <= p.clientHeight) continue;
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return p;
  }
  return null;
}

/**
 * Bring the focused field back above the keyboard.
 *
 * Not `scrollIntoView({ block: 'nearest' })`, which is what this was: the bottom of the
 * scroll area is exactly where the docked footer is, so "fully visible" to the engine is
 * a field with a button sitting on top of it. The floor here is the top of the dock when
 * one is stuck, and the bottom of the scrollport when there is not.
 *
 * It scrolls the least amount that clears the field, and nothing at all when it is
 * already clear — moving a field that was fine where it was, every time the user steps
 * to the next one, is its own kind of broken.
 */
function revealFocused() {
  const el = document.activeElement;
  if (!isEditable(el)) return;

  const scroller = scrollParent(el);
  if (!scroller) return;

  const view = scroller.getBoundingClientRect();
  const dock = scroller.querySelector(`.${DOCK_CLASS}`);
  const floor = dock ? Math.min(view.bottom, dock.getBoundingClientRect().top) : view.bottom;

  const box = el.getBoundingClientRect();
  let delta = 0;
  if (box.bottom + REVEAL_MARGIN_PX > floor) delta = box.bottom + REVEAL_MARGIN_PX - floor;
  else if (box.top - REVEAL_MARGIN_PX < view.top) delta = box.top - REVEAL_MARGIN_PX - view.top;
  if (delta !== 0) scroller.scrollBy({ top: delta, behavior: 'smooth' });
}

/**
 * Start publishing the keyboard geometry. Returns the teardown.
 *
 * Safe to call before the app has painted: everything it reads has a value at parse
 * time, and every listener is removed by the returned function.
 */
export function watchKeyboard(): () => void {
  const root = document.documentElement;
  const vv = window.visualViewport ?? null;

  let restingH = window.innerHeight;
  let restingW = window.innerWidth;
  let inset = -1;
  let open = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let revealFrame = 0;

  const scheduleReveal = () => {
    cancelAnimationFrame(revealFrame);
    revealFrame = requestAnimationFrame(revealFocused);
  };

  const measure = () => {
    const editing = isEditable(document.activeElement);

    // An orientation flip changes the width, and with it every height ever seen.
    if (window.innerWidth !== restingW) {
      restingW = window.innerWidth;
      restingH = window.innerHeight;
    } else if (!editing || window.innerHeight > restingH) {
      restingH = window.innerHeight;
    }

    const zoomed = vv !== null && vv.scale > MAX_SCALE;
    // How much of the layout viewport the keyboard covers without resizing it (iOS)…
    const overlap = vv !== null && !zoomed ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    // …and how much the engine took off the layout viewport itself (Android).
    const reflow = Math.max(0, restingH - window.innerHeight);

    const nowOpen = editing && overlap + reflow >= MIN_KEYBOARD_PX;
    const nowInset = nowOpen ? Math.round(overlap) : 0;

    if (nowInset !== inset) {
      inset = nowInset;
      root.style.setProperty('--kb-h', `${nowInset}px`);
    }
    if (nowOpen !== open) {
      open = nowOpen;
      root.classList.toggle(KB_OPEN_CLASS, nowOpen);
      // Only on the way up, and only once the geometry above is already applied — the
      // scroll area has just shrunk, so this is the frame where the field may be under
      // the keyboard. Re-running it on every scroll event would fight the user's pan.
      if (nowOpen) scheduleReveal();
    }
  };

  const onFocusIn = () => {
    // Moving between fields with the keyboard already up changes no geometry at all.
    if (open) scheduleReveal();
    measure();
  };

  const onFocusOut = () => {
    // Not measured now: the keyboard is still on screen, so the layout viewport is
    // still short and sampling it here is what would poison the resting height.
    clearTimeout(settleTimer);
    settleTimer = setTimeout(measure, SETTLE_MS);
  };

  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', measure);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  vv?.addEventListener('resize', measure);
  vv?.addEventListener('scroll', measure);

  measure();

  return () => {
    clearTimeout(settleTimer);
    cancelAnimationFrame(revealFrame);
    window.removeEventListener('resize', measure);
    window.removeEventListener('orientationchange', measure);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    vv?.removeEventListener('resize', measure);
    vv?.removeEventListener('scroll', measure);
    root.style.removeProperty('--kb-h');
    root.classList.remove(KB_OPEN_CLASS);
  };
}
