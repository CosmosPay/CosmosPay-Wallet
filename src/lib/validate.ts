/**
 * Shared validation rules.
 *
 * Rules that decide whether the wallet talks to a host, signs a value, or accepts
 * user input live here — named, in one place — instead of being re-derived as an
 * anonymous boolean inside each screen. Screens import a predicate; the store
 * re-checks the same predicate before it acts, because a disabled button is a
 * hint, not an enforcement point.
 */
import { tNow } from '@/lib/i18n';

/** Pragmatic email check: something@something.tld — matches the signup contract. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The same check as a predicate, for screens: a component imports this, never the regex. */
export function isEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}

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
 * SIX characters, and that is a product decision about friction, not a security argument —
 * the number was twelve and the comment here used to make the case for it. Be clear about
 * what it costs, because the length is the half of the vault's strength that the iteration
 * count in `constants/crypto.ts` cannot buy back: a KDF multiplies the cost of each guess,
 * the password decides how many guesses there are. Against a vault file an attacker HOLDS —
 * a restored backup, a copied profile directory — six characters from the classes below is
 * a small keyspace at any PBKDF2 cost this app can afford to spend on an unlock a user
 * waits for. What still protects a wallet at this floor is the attacker never getting the
 * file: the device lock in `lib/deviceAuth.ts`, and the failed-attempt ladder in
 * `lib/attempts.ts` for the guesses made through the app.
 *
 * It binds only what is SET from here on: `appPasswordOk` is checked when a password is
 * chosen or changed, never when one is used. So lowering it locks nobody out and shortens
 * nobody's existing password — a twelve-character one keeps working, and keeps being worth
 * more than this floor asks for.
 *
 * Each criterion is separate because the onboarding screen shows them as a live checklist;
 * `appPasswordOk` is what everything else asks. The copy is not allowed to restate the
 * number either: the four strings that name it take it as a `{n}` parameter, so this line
 * is the only place it is written down.
 */
export const MIN_APP_PWD_LEN = 6;

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
    if (url.protocol === 'http:') return tNow('validate.needsHttps');
    return tNow('validate.mustStartHttps');
  } catch {
    return tNow('validate.notAUrl');
  }
}

/* ----------------------------- access codes ----------------------------- */

/**
 * The emailed one-time code — the wallet link flow's and the social login's alike. The
 * length is the dev platform's (both of its verify schemas take six digits), written down
 * once here so no screen re-derives it.
 */
export const ACCESS_CODE_LENGTH = 6;

/** Keep only digits, capped at the code length, as the user types or pastes. */
export function normalizeAccessCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, ACCESS_CODE_LENGTH);
}

/** Whether a typed code is complete enough to send. */
export function isAccessCode(code: string): boolean {
  return code.length === ACCESS_CODE_LENGTH && /^\d+$/.test(code);
}

/**
 * Is this an https URL? The check every sign-in URL passes before it reaches the OS
 * opener — the wallet's own sign-in (`lib/signIn.ts`) and the legacy Pollar login alike.
 * One definition: a second copy is a second chance to forget that `openExternal` refuses
 * everything but https, and a refusal there is a silent no-op rather than an error anyone
 * can read.
 */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
