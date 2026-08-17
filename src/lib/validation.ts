/**
 * Single source of truth for every input rule the wallet applies.
 *
 * Screens import these predicates to enable/disable their buttons; the store
 * re-checks the SAME predicate before acting (a disabled button is a hint, not
 * an enforcement point). Pure functions only — no DOM, no store, no storage —
 * so they run under node:test with zero setup (see tests/unit/validation.test.ts).
 *
 * Every constant here is the canonical value; screens and old barrel constants
 * re-export from this module instead of re-deriving the rule inline.
 */

/** Stellar MEMO_TEXT is capped at 28 bytes. */
export const MEMO_MAX_LEN = 28;

/** Stellar asset codes are 1–12 characters. */
export const ASSET_CODE_MAX_LEN = 12;

/** Password policy: minimum length (mirrors the live criteria checklist). */
export const PWD_MIN_LEN = 8;

/** Profile name bounds (trimmed). */
export const NAME_MIN_LEN = 2;
export const NAME_MAX_LEN = 24;

/** Profile email input cap. */
export const EMAIL_MAX_LEN = 80;

/** Pragmatic email check: something@something.tld — matches the signup contract. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------- amounts ------------------------------- */

/** A positive, finite amount (matches the screens' `amt > 0` rule). */
export function isValidAmount(amount: string): boolean {
  const value = amount.trim();
  if (!value) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/** True when `amount` is a valid, positive amount that fits within `available`. */
export function isAmountWithin(amount: string, available: number): boolean {
  if (!isValidAmount(amount)) return false;
  return Number(amount) <= available;
}

/** A fiat amount that is at least one minor unit (0.01) — mirrors `toMinor() >= 1`. */
export function isValidFiatAmount(amount: string): boolean {
  return Math.round((parseFloat(amount) || 0) * 100) >= 1;
}

/** True when an amount string has at most 7 decimal places (Stellar precision). */
export function hasAtMostSevenDecimals(amount: string): boolean {
  const value = amount.trim();
  const dot = value.indexOf('.');
  return dot === -1 || value.slice(dot + 1).length <= 7;
}

/**
 * Sanitize a free-typed amount input: digits + one dot, at most 7 decimals.
 * Callers decide whether to apply the result (see Send's editAmountInput, which
 * also enforces the 12-significant-digit cap via isWithinAmountDigitLimit).
 */
export function sanitizeAmountInput(raw: string): string {
  let v = raw.replace(',', '.').replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 7);
  return v;
}

/** True when the amount has at most `maxDigits` significant digits (default 12). */
export function isWithinAmountDigitLimit(amount: string, maxDigits = 12): boolean {
  return amount.replace('.', '').length <= maxDigits;
}

/* -------------------------------- memos -------------------------------- */

/** Clamp a memo to the Stellar text-memo limit (28 bytes). */
export function clampMemo(memo: string): string {
  return memo.slice(0, MEMO_MAX_LEN);
}

/** True when the memo fits the text-memo limit. */
export function isValidMemo(memo: string): boolean {
  return memo.length <= MEMO_MAX_LEN;
}

/* ------------------------------ identity ------------------------------- */

/** True for a plausible email address (the signup contract). */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** True when the profile name is 2–24 characters after trimming. */
export function isValidName(name: string): boolean {
  const t = name.trim();
  return t.length >= NAME_MIN_LEN && t.length <= NAME_MAX_LEN;
}

/** True for a 1–12 character Stellar asset code. */
export function isValidAssetCode(code: string): boolean {
  const c = code.trim();
  return c.length >= 1 && c.length <= ASSET_CODE_MAX_LEN;
}

/* ------------------------------- password ------------------------------ */

export function hasMinLength(pwd: string): boolean {
  return pwd.length >= PWD_MIN_LEN;
}
export function hasUppercase(pwd: string): boolean {
  return /[A-Z]/.test(pwd);
}
export function hasDigit(pwd: string): boolean {
  return /\d/.test(pwd);
}
export function hasLowercase(pwd: string): boolean {
  return /[a-z]/.test(pwd);
}

/** The full vault password policy (mirrors PasswordSetup's live checklist). */
export function isValidPassword(pwd: string): boolean {
  return hasMinLength(pwd) && hasUppercase(pwd) && hasDigit(pwd) && hasLowercase(pwd);
}

/* ------------------------------- endpoints ------------------------------ */

/** True for an http(s) URL with a real hostname (custom Horizon / endpoint override). */
export function isValidEndpointUrl(url: string): boolean {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const parsed = new URL(u);
    return !!parsed.hostname;
  } catch {
    return false;
  }
}

/** True for a custom network name (at least 2 chars). */
export function isValidNetworkName(name: string): boolean {
  return name.trim().length > 1;
}

/** True for a network passphrase (at least 4 chars — a real network's phrase). */
export function isValidNetworkPassphrase(passphrase: string): boolean {
  return passphrase.trim().length > 3;
}

/* ------------------------------ link codes ------------------------------ */

/** True when the emailed access link code is exactly 6 digits (as typed). */
export function isValidLinkCode(code: string): boolean {
  return code.length === 6;
}
