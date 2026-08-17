/**
 * One decimal parser for the whole wallet.
 *
 * There used to be several: `Send` sanitised keystrokes and swapped comma for dot,
 * Swap/LP/fiat read a bare input with `parseFloat`, and `toMinor` did
 * `parseFloat(s) * 100`. `parseFloat` stops at the first character it cannot read,
 * so on a Spanish keyboard `parseFloat('1,50')` is `1` — the fiat off-ramp asked
 * the API for 100 cents when the user typed 1,50. Same string, four readings.
 *
 * Rules here: comma and dot are both decimal separators, nothing else is accepted
 * (no sign, no exponent, no thousands separator, no whitespace inside), and minor
 * units are computed with string arithmetic so 2-decimal money never picks up a
 * binary-float rounding error.
 */

/** Stellar amounts carry at most 7 decimal places. */
export const STELLAR_DECIMALS = 7;
/** Fiat/token amounts on the CosmosPay API are integer minor units (cents). */
export const FIAT_DECIMALS = 2;
/** Digit budget for a typed amount, ignoring the separator. */
export const AMOUNT_MAX_DIGITS = 12;

/** Digits, optionally one separator, optionally more digits. Deliberately strict. */
const DECIMAL_RE = /^\d*(?:[.,]\d*)?$/;

function normalize(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v || !DECIMAL_RE.test(v)) return null;
  return v.replace(',', '.');
}

/**
 * Parse a user-typed decimal. Returns null for anything that is not a plain
 * non-negative decimal — callers must decide what an unreadable amount means
 * rather than silently receiving 0.
 */
export function parseDecimal(raw: unknown): number | null {
  const v = normalize(raw);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Convenience for display maths where "not a number" and "zero" are equivalent. */
export function parseDecimalOr0(raw: unknown): number {
  return parseDecimal(raw) ?? 0;
}

/**
 * Exact conversion to integer minor units, e.g. "1,50" -> 150 with `decimals = 2`.
 * Done on the digit string, so no `1.155 * 100 = 115.49999…` surprises; the first
 * dropped digit rounds half-up, matching what the previous Math.round did for the
 * values it happened to read correctly.
 */
export function toMinorUnits(raw: unknown, decimals = FIAT_DECIMALS): number | null {
  // A thin wrapper, not a second implementation: the two used to be near-identical
  // copies of the same half-up rounding, which meant two places that had to agree
  // forever about how money rounds.
  const n = toMinorUnitsBig(raw, decimals);
  return n === null ? null : Number(n);
}

/**
 * The same conversion as `toMinorUnits`, but exact for every value Stellar can
 * represent. `toMinorUnits` returns a `number`, and stroops (7 decimals) pass
 * `Number.MAX_SAFE_INTEGER` at ~900 million XLM — below Stellar's own maximum. Any
 * comparison that decides whether money may move uses this one; see `lib/txGuard.ts`.
 */
export function toMinorUnitsBig(raw: unknown, decimals = FIAT_DECIMALS): bigint | null {
  const v = normalize(raw);
  if (v === null) return null;
  const [int = '', frac = ''] = v.split('.');
  const kept = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const dropped = frac.slice(decimals);
  let n: bigint;
  try {
    n = BigInt((int || '0') + kept);
  } catch {
    return null;
  }
  if (dropped && Number(dropped[0]) >= 5) n += 1n;
  return n;
}

/**
 * Inverse of `toMinorUnitsBig`: 150 -> "1.50" with `decimals = 2`. String maths, so
 * it is the safe replacement for the `cents / 100` division that used to derive the
 * off-ramp's signing bound in the store.
 */
export function fromMinorUnits(minor: number | bigint, decimals = FIAT_DECIMALS): string | null {
  if (typeof minor === 'number' && !Number.isInteger(minor)) return null;
  let n: bigint;
  try {
    n = typeof minor === 'bigint' ? minor : BigInt(minor);
  } catch {
    return null;
  }
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const frac = decimals ? digits.slice(digits.length - decimals) : '';
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * `raw` reduced by `bps` basis points, exact. Used to turn a quoted estimate into
 * the floor the signed envelope must still honour: a swap quoted at 100 with 50 bps
 * of slippage may not come back promising less than 99.5.
 */
export function reduceByBps(raw: unknown, bps: number, decimals = STELLAR_DECIMALS): string | null {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) return null;
  const n = toMinorUnitsBig(raw, decimals);
  if (n === null) return null;
  return fromMinorUnits((n * BigInt(10_000 - bps)) / 10_000n, decimals);
}

/**
 * Filter a keystroke in a decimal field: strips anything that is not a digit or a
 * separator, keeps a single separator, caps the fraction. Returns null when the
 * result would exceed the digit budget — the caller drops the keystroke.
 */
export function sanitizeDecimalInput(
  raw: string,
  decimals = STELLAR_DECIMALS,
  maxDigits = AMOUNT_MAX_DIGITS,
): string | null {
  let v = String(raw ?? '').replace(',', '.').replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, decimals);
  if (v.replace('.', '').length > maxDigits) return null;
  return v;
}
