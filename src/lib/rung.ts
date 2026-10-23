/**
 * A proportion as a CSS class, for the bars and meters the redesign draws (allocation,
 * top movers). A width is a VALUE, and the app has no inline styles (CLAUDE.md): so, like
 * the stagger ladder, it is a fixed ladder of classes — `.is-w-0` … `.is-w-20`, 5% a rung —
 * defined once in `src/styles/ui/meter.css`, and this picks the rung.
 */

/** Rungs on the ladder: 0%, 5%, … 100%. Keep equal to the classes in meter.css. */
export const WIDTH_RUNGS = 20;

/**
 * The `.is-w-<n>` class for `fraction` (0…1). Anything above zero gets at least the first
 * visible rung, so a holding that is a sliver of the total still shows as a sliver rather
 * than as nothing.
 */
export function widthRung(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return 'is-w-0';
  const step = Math.min(WIDTH_RUNGS, Math.max(1, Math.round(fraction * WIDTH_RUNGS)));
  return `is-w-${step}`;
}
