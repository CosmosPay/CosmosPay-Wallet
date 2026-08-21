/**
 * Where the on-screen keyboard ends up, published to CSS as `--kb-h` on <html> plus a
 * `kb-open` class.
 *
 * Two engines answer the keyboard in two different ways, and BOTH are funnelled into one
 * number so the app moves the same way either way — through a single transition rather
 * than one motion the engine imposes and another the app adds on top:
 *
 * - Android — Chrome with `interactive-widget=resizes-content`, and the Capacitor WebView,
 *   which the activity resizes — shrinks the LAYOUT viewport. `100dvh` goes with it, so
 *   the whole frame reflows in one frame, with nothing to ease. `--kb-reflow` is exactly
 *   what the engine took, and `.shell-frame` adds it straight back (no transition, same
 *   frame the shrink lands in), which leaves the frame the size it always was.
 * - iOS (WKWebView and Safari) shrinks only the VISUAL viewport, so the frame never moved
 *   in the first place and `--kb-reflow` is `0px`.
 *
 * After that both look identical: the keyboard is covering the bottom `--kb-h` of a frame
 * that did not change size, and `.shell-content` eases that much padding in
 * (src/styles/app/shell.css) so the scroll area ends where the keyboard begins. The
 * screen reshapes over those 220ms — the field, the copy and the docked button together —
 * instead of the layout snapping and the content sliding after it.
 *
 * What this deliberately does NOT do is read every visual-viewport change as a keyboard.
 * iOS Safari collapses its own toolbars on scroll and pinch-zoom moves the same numbers;
 * either one would dock a button for no reason. A reading counts only while an editable
 * element holds focus, at scale 1, and past a threshold no toolbar reaches.
 *
 * The resting height is the other half of that: on Android it is the only evidence a
 * keyboard is up at all — and the size the frame is held at — and it cannot be sampled
 * while typing, because that is exactly when it is wrong. It tracks the tallest layout
 * viewport seen since the last width change (an orientation flip), and drops back only
 * when nothing editable has focus. Rotating WITH the keyboard already up is the one case
 * it cannot recover: the flip resets it to a height the keyboard is already eating, so
 * until the keyboard closes once, Android falls back to letting the engine own the
 * layout — which is what it did before any of this, not a broken state.
 */

/** Below this a gap is a collapsing URL bar or a toolbar, not a keyboard. */
const MIN_KEYBOARD_PX = 96;

/** Pinch-zoom shrinks the visual viewport too — past this the reading means nothing. */
const MAX_SCALE = 1.05;

/** Long enough for a keyboard dismissal to finish before the geometry is re-read. */
const SETTLE_MS = 350;

/**
 * How long to let the layout settle before working out where the focused field ended up.
 * Pairs with — and deliberately only just outruns — the 0.22s `padding-bottom` transition
 * on `.shell-content` (src/styles/app/shell.css): measured any earlier the scroll area is
 * still its old height and the scroll comes out short, and measured much later it reads
 * as a second, separate movement instead of the tail of the first.
 */
const KB_SETTLE_MS = 240;

/** Stepping between two fields moves no geometry — just wait out the focus change. */
const FOCUS_SETTLE_MS = 60;

/** Set on <html> while a keyboard is up, whichever way the engine reported it. */
const KB_OPEN_CLASS = 'kb-open';

/** The footer a screen docks above the keyboard — see `.kb-dock` in src/styles/app.css. */
const DOCK_CLASS = 'kb-dock';

/**
 * A field and the controls that act on it, marked as one thing to reveal together.
 * An attribute rather than a class because nothing styles it: it exists only to be read
 * here. `[data-kb-group]` on the wrapper is the whole contract.
 */
const GROUP_ATTR = 'data-kb-group';

/** Clearance left around a field that had to be scrolled back into view. */
const REVEAL_MARGIN_PX = 12;

/** Whether to ease the reveal scroll, matching the reduced-motion block in animations.css. */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

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
 * one is stuck, and the bottom of the scrollport when there is not — and what gets
 * revealed is the field's control group, when it declares one.
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

  // Reveal the field's whole control group where it has one. A field with its button
  // directly under it is one thing to the user, and scrolling the field neatly into view
  // while leaving that button below the fold is the same complaint in a smaller form.
  // Only while the group actually fits — otherwise honouring it would push the field
  // itself off the top, which is worse than the button being out of sight.
  const group = el.closest<HTMLElement>(`[${GROUP_ATTR}]`);
  const target = group && group.getBoundingClientRect().height <= floor - view.top ? group : el;

  const box = target.getBoundingClientRect();
  let delta = 0;
  if (box.bottom + REVEAL_MARGIN_PX > floor) delta = box.bottom + REVEAL_MARGIN_PX - floor;
  else if (box.top - REVEAL_MARGIN_PX < view.top) delta = box.top - REVEAL_MARGIN_PX - view.top;
  if (delta !== 0) scroller.scrollBy({ top: delta, behavior: scrollBehavior() });
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
  let revealTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleReveal = (delayMs: number) => {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(revealFocused, delayMs);
  };

  const measure = () => {
    const editing = isEditable(document.activeElement);
    const wasInset = inset;

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
    // One number for how much of the frame the keyboard is over, whichever way it got
    // there. The split only matters to `.shell-frame`, which gives `--kb-reflow` back so
    // that frame stops changing size and every screen can ease instead of snap.
    const nowInset = nowOpen ? Math.round(overlap + reflow) : 0;
    const nowReflow = nowOpen ? Math.round(reflow) : 0;

    if (nowInset !== inset) {
      inset = nowInset;
      root.style.setProperty('--kb-h', `${nowInset}px`);
      // Set together with --kb-h, and read by a rule with no transition on it: the frame
      // has to grow back in the SAME frame the engine shrank it, or the compensation is
      // itself a flicker.
      root.style.setProperty('--kb-reflow', `${nowReflow}px`);
    }
    if (nowOpen !== open) {
      open = nowOpen;
      root.classList.toggle(KB_OPEN_CLASS, nowOpen);
    }

    // On the way up only, and DEBOUNCED on the inset rather than fired once on the open
    // edge: an engine reports the keyboard as it slides in, a step per frame, and a reveal
    // scheduled off the first step that cleared the threshold measures a scroll area still
    // most of a keyboard too tall. Every step pushes the timer out, so this runs once,
    // after the last one — and after the inset has finished easing in on top of that. A
    // scroll event moves the number not at all, so it never fights the user's own pan.
    if (nowOpen && nowInset !== wasInset) scheduleReveal(KB_SETTLE_MS);
  };

  const onFocusIn = () => {
    // Moving between fields with the keyboard already up changes no geometry at all, so
    // there is no transition to wait out — only the focus change itself.
    if (open) scheduleReveal(FOCUS_SETTLE_MS);
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
    clearTimeout(revealTimer);
    window.removeEventListener('resize', measure);
    window.removeEventListener('orientationchange', measure);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    vv?.removeEventListener('resize', measure);
    vv?.removeEventListener('scroll', measure);
    root.style.removeProperty('--kb-h');
    root.style.removeProperty('--kb-reflow');
    root.classList.remove(KB_OPEN_CLASS);
  };
}
