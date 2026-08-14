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
