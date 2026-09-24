/**
 * `/.well-known/stellar.toml` — how the wallet learns what a recovery server is.
 *
 * SEP-30 describes endpoints and says nothing about discovery: a client is assumed to
 * already know the base URL and who is behind it. SEP-10, which every SEP-30 call is
 * authenticated with, does specify it, and two fields carry the whole of it:
 *
 * - `WEB_AUTH_ENDPOINT` — where to fetch and return a challenge.
 * - `SIGNING_KEY` — the account that signs those challenges, and the one field that turns
 *   SEP-10 from a ritual into a proof. Without it the wallet can check that a challenge
 *   is well formed and unsubmittable, but not that it came from the server it means to
 *   authenticate to. `assertSafeChallenge` takes it as an expectation for that reason.
 *
 * This is deliberately NOT a general TOML parser. It reads top-level `KEY = "value"` pairs
 * and stops at the first table header, which is every field above and nothing else — a
 * parser is an attack surface, and this one is fed by a host the user typed into a
 * settings field. Anything it does not understand is absent, and absent is a refusal
 * upstream rather than a default.
 */
import { isHttpsUrl } from '@/lib/validate';

/** What a wallet needs from a server's TOML. Absent fields stay undefined, never guessed. */
export interface StellarToml {
  webAuthEndpoint?: string;
  signingKey?: string;
  networkPassphrase?: string;
  horizonUrl?: string;
  /**
   * The domain the server's SEP-10 challenges name.
   *
   * NOT the host this file was fetched from, and the difference is the whole point: the
   * two recovery servers are separate hosts that deliberately name the same wallet, which
   * is what lets a client require both to agree on it — neither operator can change what
   * the other says. Deriving it from the host would make the two disagree by construction
   * and refuse every pair. Absent falls back to the host, which is right for a standalone
   * server that is only ever itself.
   */
  homeDomain?: string;
}

/** At most this many bytes are read. A TOML is a few hundred; anything larger is not one. */
const MAX_BYTES = 64 * 1024;

/** A Stellar public key, checked by shape only — what it signs is what proves it. */
const isAccountId = (v: string): boolean => /^G[A-Z2-7]{55}$/.test(v);

/**
 * Parse the top-level key/value pairs.
 *
 * Stops at the first `[table]` or `[[array]]` header: every field this reads is defined at
 * the top level, and a key of the same name inside a table is a different key. Reading on
 * would let a nested `SIGNING_KEY` — in a `[[CURRENCIES]]` block, say — overwrite the
 * server's own.
 */
export function parseStellarToml(text: string): StellarToml {
  const out: StellarToml = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) break;

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toUpperCase();
    let value = line.slice(eq + 1).trim();

    // Strip a trailing comment only when the value is not quoted — a `#` inside a quoted
    // string is data, and a passphrase is exactly the field likely to contain one.
    const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
    if (quoted) {
      value = quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      value = value.split('#')[0].trim();
    }
    if (!value) continue;

    if (key === 'WEB_AUTH_ENDPOINT' && isHttpsUrl(value)) out.webAuthEndpoint = value;
    else if (key === 'SIGNING_KEY' && isAccountId(value)) out.signingKey = value;
    else if (key === 'HOME_DOMAIN') out.homeDomain = value;
    else if (key === 'NETWORK_PASSPHRASE') out.networkPassphrase = value;
    else if (key === 'HORIZON_URL' && isHttpsUrl(value)) out.horizonUrl = value;
  }
  return out;
}

/**
 * Fetch and read a host's TOML, or null when it has none.
 *
 * Null is an answer, not a failure: a deployment that predates this file still describes
 * itself through its own `/api/recovery/info`, and the caller falls back to that. What is
 * never done is inventing a value — a guessed `SIGNING_KEY` would be a check that passes
 * against whoever answered.
 */
export async function fetchStellarToml(origin: string): Promise<StellarToml | null> {
  let url: string;
  try {
    url = new URL('/.well-known/stellar.toml', origin).toString();
  } catch {
    return null;
  }

  try {
    const res = await fetch(url, { headers: { Accept: 'text/plain' } });
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, MAX_BYTES);
    const toml = parseStellarToml(text);
    // A TOML with neither field tells the wallet nothing it can act on, and treating it as
    // present would mean skipping the fallback that does.
    return toml.webAuthEndpoint || toml.signingKey ? toml : null;
  } catch {
    return null;
  }
}
