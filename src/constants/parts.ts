/** Constants shared by the src/components/parts primitives. */

/** Numeric keypad layout shared by Send / Swap amount entry (NumberPad). */
export const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/** Toast exit-animation length in ms — must match the popOut / toastDown
 *  animation duration (.23s) the .is-leaving class runs in toast.css. */
export const TOAST_EXIT_MS = 230;

/** Rungs on the staggered-entrance ladder in src/styles/animations.css.
 *  Keep in sync with the number of .stagger-* / .stagger-dense-* classes. */
export const STAGGER_STEPS = 12;

/**
 * Modifier class that delays a list row's entrance by its position.
 *
 * The delay used to be an inline `animationDelay`; it is a fixed CSS ladder now
 * (see CLAUDE.md). Indexes past the last rung reuse it, so an arbitrarily long
 * list keeps the final delay instead of growing without bound.
 *
 * `dense` picks the tighter 30ms ladder used by the full History screen; the
 * default 50ms one is for the shorter Home previews and Markets.
 */
export function staggerClass(index: number, dense = false): string {
  const step = Math.min(Math.max(index, 0), STAGGER_STEPS - 1);
  return `${dense ? 'stagger-dense' : 'stagger'}-${step}`;
}
