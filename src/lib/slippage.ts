/**
 * The max slippage a person picks in the swap screens' sheet (`src/features/money/SlippageControl.tsx`).
 *
 * Kept out of the component because it is the one number in a swap the person sets
 * directly: what reaches the gateway must be in range whether it came from a tap, the
 * stepper, or a value left in storage by an older build.
 */
import {
  SLIPPAGE_COARSE_FROM_BPS,
  SLIPPAGE_COARSE_STEP_BPS,
  SLIPPAGE_FINE_STEP_BPS,
  SLIPPAGE_MAX_BPS,
  SLIPPAGE_MIN_BPS,
  SLIPPAGE_WARN_BPS,
} from '@/constants/swap';

/** A choice clamped to the range the sheet offers, as a whole number of basis points. */
export function clampSlippageBps(bps: number): number {
  if (!Number.isFinite(bps)) return SLIPPAGE_MIN_BPS;
  return Math.min(SLIPPAGE_MAX_BPS, Math.max(SLIPPAGE_MIN_BPS, Math.round(bps)));
}

/**
 * What a stored preference means: a number in range, or null for "auto" (each venue keeps
 * its own default). Anything else — out of range, not an integer, garbage — is auto too,
 * rather than clamped: a value nobody chose is not a choice to round towards.
 */
export function parseSlippagePref(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < SLIPPAGE_MIN_BPS || n > SLIPPAGE_MAX_BPS) return null;
  return n;
}

/** One press of the stepper: 0.1% at a time below 1%, 0.5% from 1% up, snapped to the step. */
export function stepSlippage(bps: number, dir: 1 | -1): number {
  const coarse = dir > 0 ? bps >= SLIPPAGE_COARSE_FROM_BPS : bps > SLIPPAGE_COARSE_FROM_BPS;
  const step = coarse ? SLIPPAGE_COARSE_STEP_BPS : SLIPPAGE_FINE_STEP_BPS;
  const next = dir > 0 ? Math.floor(bps / step) * step + step : Math.ceil(bps / step) * step - step;
  return clampSlippageBps(next);
}

/** The slippage a request carries: the person's choice, or the venue's default when there is none. */
export const slippageFor = (choice: number | null, venueDefault: number): number => choice ?? venueDefault;

/** A tolerance worth a warning in the sheet: from here the minimum received drops noticeably. */
export const isHighSlippage = (bps: number): boolean => bps >= SLIPPAGE_WARN_BPS;
