/**
 * Staggered list entrances.
 *
 * The delay used to be an inline `animationDelay`; it is a fixed CSS ladder now (see
 * CLAUDE.md and animations.css). Indexes past the last rung reuse it, so an
 * arbitrarily long list keeps the final delay instead of growing without bound.
 *
 * Lives in lib/, not constants/: it is behaviour, and constants/ holds data only.
 */

/** Rungs on the ladder in src/styles/animations.css.
 *  Keep in sync with the number of .stagger-* / .stagger-dense-* classes. */
export const STAGGER_STEPS = 12;

/**
 * Modifier class that delays a row's entrance by its position.
 * `dense` picks the tighter 30ms ladder used by the full History screen; the default
 * 50ms one is for the shorter Home previews and Markets.
 */
export function staggerClass(index: number, dense = false): string {
  const step = Math.min(Math.max(index, 0), STAGGER_STEPS - 1);
  return `${dense ? 'stagger-dense' : 'stagger'}-${step}`;
}
