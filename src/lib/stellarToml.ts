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
 * The SEP-30 base itself — what `/accounts` hangs off — has no SEP-1 field, so the
 * community server publishes it in a `[[RECOVERY_SERVERS]]` entry, with its role and the
 * ways it can prove an inbox. The wallet used to build that path itself (`/api/recovery`),
 * which is exactly what tied it to one operator's URL layout.
 *
 * This is deliberately NOT a general TOML parser. It reads top-level `KEY = "value"` pairs
 * and the FIRST `[[RECOVERY_SERVERS]]` entry, and ignores every other table — a parser is
 * an attack surface, and this one is fed by a host the user typed into a settings field.
 * A key inside a table is never read as a top-level one: a `SIGNING_KEY` in a
 * `[[CURRENCIES]]` block is a different key with the same name. Anything it does not
 * understand is absent, and absent is a refusal upstream rather than a default.
 */
import { isHttpsUrl } from '@/lib/validate';

/** The first `[[RECOVERY_SERVERS]]` entry, as far as the wallet reads it. */
export interface TomlRecoveryServer {
  /** The SEP-30 base: `${endpoint}/accounts` is `GET /accounts`. */
  endpoint?: string;
  role?: string;
  /** The OIDC issuer whose ID tokens this server exchanges for an identity. */
  oidcIssuer?: string;
  /** Whether this server can prove an inbox with its own emailed code. */
  emailCodes?: boolean;
}

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
   * and refuse every pair.
   */
  homeDomain?: string;
  recovery?: TomlRecoveryServer;
}

/** At most this many bytes are read. A TOML is a few hundred; anything larger is not one. */
const MAX_BYTES = 64 * 1024;

/** A Stellar public key, checked by shape only — what it signs is what proves it. */
const isAccountId = (v: string): boolean => /^G[A-Z2-7]{55}$/.test(v);

/** A value with its quotes and escapes handled, or null for an empty one. */
function readValue(raw: string): { value: string; quoted: boolean } | null {
  let value = raw.trim();
  // Strip a trailing comment only when the value is not quoted — a `#` inside a quoted
  // string is data, and a passphrase is exactly the field likely to contain one.
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  if (quoted) {
    value = quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  } else {
    value = value.split('#')[0].trim();
  }
  return value ? { value, quoted: !!quoted } : null;
}

/**
 * Parse the top-level pairs and the first `[[RECOVERY_SERVERS]]` entry.
 *
 * Every other table is skipped over in its entirety, and a second `[[RECOVERY_SERVERS]]`
 * entry ends the recovery read: this file describes the server that served it, and a list
 * of several would be a server vouching for others — which the wallet does not take on its
 * word. Its partner is configured, not discovered.
 */
export function parseStellarToml(text: string): StellarToml {
  const out: StellarToml = {};
  let section: 'top' | 'recovery' | 'other' = 'top';
  let recoverySeen = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      const isRecovery = /^\[\[\s*RECOVERY_SERVERS\s*\]\]$/i.test(line) && !recoverySeen;
      if (isRecovery) {
        recoverySeen = true;
        out.recovery = {};
      }
      section = isRecovery ? 'recovery' : 'other';
      continue;
    }
    if (section === 'other') continue;

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toUpperCase();
    const read = readValue(line.slice(eq + 1));
    if (!read) continue;
    const { value, quoted } = read;

    if (section === 'recovery' && out.recovery) {
      if (key === 'ENDPOINT' && isHttpsUrl(value)) out.recovery.endpoint = value;
      else if (key === 'ROLE') out.recovery.role = value;
      else if (key === 'OIDC_ISSUER' && isHttpsUrl(value)) out.recovery.oidcIssuer = value;
      // A bare boolean only: `"true"` in quotes is a string, and a string is not a claim
      // this parser turns into a capability.
      else if (key === 'EMAIL_CODES' && !quoted) out.recovery.emailCodes = value === 'true';
      continue;
    }

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
 * Null is an answer, and upstream it is a refusal: a recovery server the wallet cannot
 * check the `SIGNING_KEY` of is one whose challenges it would sign on a stranger's word.
 * What is never done is inventing a value — a guessed key is a check that passes against
 * whoever answered.
 */
export async function fetchStellarToml(origin: string): Promise<StellarToml | null> {
  let url: string;
  try {
    url = new URL('/.well-known/stellar.toml', origin).toString();
  } catch {
    return null;
  }

  try {
    const res = await fetch(url, { headers: { Accept: 'text/plain' }, redirect: 'error' });
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, MAX_BYTES);
    const toml = parseStellarToml(text);
    return toml.webAuthEndpoint || toml.signingKey ? toml : null;
  } catch {
    return null;
  }
}
