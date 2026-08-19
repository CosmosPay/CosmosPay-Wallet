/**
 * Shared validation rules.
 *
 * Rules that decide whether the wallet talks to a host, signs a value, or accepts
 * user input live here — named, in one place — instead of being re-derived as an
 * anonymous boolean inside each screen. Screens import a predicate; the store
 * re-checks the same predicate before it acts, because a disabled button is a
 * hint, not an enforcement point.
 */

/** Pragmatic email check: something@something.tld — matches the signup contract. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ----------------------------- app password ----------------------------- */

/**
 * The rule that decides what may seal a vault. ONE definition, on purpose.
 *
 * It was re-derived in two screens and they disagreed: onboarding demanded 8 characters
 * plus an upper, a lower and a digit — three bare regexes and a bare `8` inside a `.tsx` —
 * while the change-password form demanded length alone, and neither the store nor
 * `vault.changePassword` re-checked anything. A user forced to choose `Abcdefg1` could
 * change it to `aaaaaaaa` the next minute, and every device-lock envelope was re-sealed
 * under it. The weakest of two disagreeing rules is the one that ends up protecting the
 * seed.
 *
 * Each criterion is separate because the onboarding screen shows them as a live checklist;
 * `appPasswordOk` is what everything else asks.
 */
export const MIN_APP_PWD_LEN = 8;

export const APP_PWD_CRITERIA = {
  length: (p: string) => p.length >= MIN_APP_PWD_LEN,
  upper: (p: string) => /[A-Z]/.test(p),
  lower: (p: string) => /[a-z]/.test(p),
  digit: (p: string) => /\d/.test(p),
} as const;

/** Is this string allowed to encrypt a wallet? Checked in the store, not only in a form. */
export function appPasswordOk(pwd: string): boolean {
  return Object.values(APP_PWD_CRITERIA).every((met) => met(pwd));
}

/** Loopback hosts, where cleartext http is a local dev server and not a downgrade. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Is this a Horizon endpoint the wallet may use?
 *
 * TLS is required for anything non-loopback: a custom network's Horizon sees every
 * balance query and receives every signed envelope the wallet submits, so cleartext
 * there means a network attacker reads the account and can withhold or replay
 * submissions. Loopback stays allowed so a local core/Horizon still works.
 */
export function isSafeHorizonUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname);
}

/** Why an endpoint was rejected, for the UI to show. Null when it is acceptable. */
export function horizonUrlProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null; // empty: the form is simply incomplete, not wrong
  try {
    const url = new URL(v);
    if (url.protocol === 'https:') return null;
    if (url.protocol === 'http:' && LOOPBACK.has(url.hostname)) return null;
    if (url.protocol === 'http:') return 'Usa https:// — con http tu saldo y tus transacciones viajan sin cifrar.';
    return 'La dirección debe empezar por https://';
  } catch {
    return 'La dirección no es una URL válida.';
  }
}
