/**
 * PKCE (RFC 7636), S256.
 *
 * What it buys here, concretely: a sign-in ends with a single-use handshake the community
 * server holds, and the `state` that names it travels through a browser the wallet does not
 * control — a system browser tab, a redirect chain, an OS log, a screenshot of the "you can
 * close this window" page. PKCE makes that useless on its own: redeeming it also requires
 * the verifier, which never leaves this process.
 *
 * Its own module because it is pure RFC 7636, and because it is the part worth a unit test.
 */
import { PKCE_METHOD, PKCE_VERIFIER_BYTES } from '@/constants/signIn';

export interface Pkce {
  /** Kept by the wallet, sent only at redemption. */
  verifier: string;
  /** Sent at authorize, and safe to be seen — it is a hash. */
  challenge: string;
  method: typeof PKCE_METHOD;
}

/**
 * base64url of some bytes: base64 with `+/` swapped for `-_` and the padding dropped.
 *
 * Written out rather than reached for from a library because the alphabet is the whole
 * point: standard base64 puts `+` and `/` in a value that rides in a query string,
 * where both are reserved. A verifier that round-trips through a URL-encoder as `%2B`
 * is a verifier the server hashes differently, and the failure surfaces as an opaque
 * "invalid code" at the last step of a login that otherwise worked.
 */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A fresh verifier/challenge pair.
 *
 * `crypto.getRandomValues`, never `Math.random`: the verifier is the only thing
 * standing between a leaked code and a stranger's session, so it has to be
 * unpredictable in the cryptographic sense and not merely spread out.
 *
 * `crypto.subtle` needs a secure context, which is why the desktop build must keep
 * loading over Tauri's own scheme rather than `file://` — the same constraint the
 * vault has, noted in CLAUDE.md.
 */
export async function newPkce(): Promise<Pkce> {
  const raw = new Uint8Array(PKCE_VERIFIER_BYTES);
  crypto.getRandomValues(raw);
  const verifier = base64url(raw);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)), method: PKCE_METHOD };
}
