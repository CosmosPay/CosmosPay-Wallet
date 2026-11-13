/**
 * SEP-10 web authentication, from the wallet's side — proving to a recovery server that
 * this device holds an account's key.
 *
 * ## Why a challenge is checked before it is signed
 *
 * The server hands over a transaction and asks for a signature on it. That is the exact
 * shape of every attack `lib/txGuard.ts` exists to refuse, and "it is only a SEP-10
 * challenge" is the server's claim about its own bytes. What makes a challenge harmless is
 * a property the wallet can verify for itself: **sequence number 0**. No account's sequence
 * is ever 0 after creation, so a transaction built on it can never be submitted — the
 * network rejects it as `tx_bad_seq` forever. Everything else below narrows further, but
 * that one line is the reason signing a stranger's transaction is safe here at all.
 *
 * So `assertSafeChallenge` refuses anything that is not exactly SEP-10's shape: a non-zero
 * sequence, an operation that is not `manageData`, a first operation not sourced by us, a
 * `web_auth_domain` naming a different server, a missing or unbounded window, a memo, a
 * fee bump. A challenge that fails any of them is not signed and the flow stops.
 *
 * ## Who calls it
 *
 * Not a login for the wallet, and not something a dapp can ask for. Two callers:
 *
 * - the two recovery servers in `lib/recovery.ts`, whose token can do exactly two things
 *   there: register an account for recovery, and change which identities may recover it.
 *   Both already require the key this proves.
 * - the manual "sign transaction" screen, when the person pastes a challenge a service
 *   (an anchor's SEP-24 deposit, say) handed them to sign — see `lib/webAuth.ts`. There
 *   the expectations come from the challenge's own home domain and that domain's
 *   `stellar.toml`, and the server's signature on it is verified (`assertServerSigned`),
 *   because nothing configured vouches for the service the way it does for recovery.
 */
import { FeeBumpTransaction, Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { tNow } from '@/lib/i18n';
import type { NetConfig } from '@/lib/stellar';

/** Why a challenge was refused. `key` is an i18n key so nothing branches on copy. */
export class Sep10Error extends Error {
  readonly key: string;
  constructor(key: string) {
    super(tNow(key));
    this.name = 'Sep10Error';
    this.key = key;
  }
}

/** SEP-10 puts 48 random bytes in the first operation's value, base64-encoded. */
const NONCE_BYTES = 48;

/** A challenge is minted to be signed within seconds; anything wider is not one. */
const MAX_WINDOW_S = 15 * 60;

/** Clock skew tolerated at both ends — the same reason as the guard's: phones drift. */
const CLOCK_SKEW_S = 5 * 60;

export interface ChallengeExpectation {
  /** The account being authenticated: us. */
  account: string;
  /** The wallet's domain, as the server reports it in its stellar.toml (`HOME_DOMAIN`). */
  homeDomain: string;
  /** THIS server's host. What stops a challenge minted for its sibling being replayed here. */
  webAuthDomain: string;
  /**
   * The server's `SIGNING_KEY`, from its `/.well-known/stellar.toml`.
   *
   * SEP-10 makes this the account that sources and signs the challenge, and checking it is
   * what turns the exchange from a ritual into a proof: without it the wallet knows the
   * challenge is well formed and unsubmittable, but not that it came from the server it
   * believes it is authenticating to. Optional only because a deployment that publishes no
   * TOML cannot be checked against one — and `undefined` skips the check rather than
   * inventing a key, which would pass against whoever answered.
   */
  signingKey?: string;
}

const utf8 = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return new TextDecoder().decode(v);
  return String(v ?? '');
};

/**
 * Decode a challenge and refuse everything that is not one.
 *
 * `cfg.passphrase` is the wallet's own network, never the server's: `fromXDR` does not
 * verify a passphrase, it only decides which network's hash gets signed, so taking it from
 * the counterparty is how a "recovery server" collects a mainnet signature. The caller
 * checks that the server SERVES this network before getting here; this is where the
 * signature is actually bound to it.
 */
export function assertSafeChallenge(
  cfg: NetConfig,
  xdr: string,
  expect: ChallengeExpectation,
  now = Math.floor(Date.now() / 1000),
): Transaction {
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(xdr.trim(), cfg.passphrase);
  } catch {
    throw new Sep10Error('sep10.error.undecodable');
  }
  if (tx instanceof FeeBumpTransaction) throw new Sep10Error('sep10.error.feeBump');

  // The one property that makes signing safe: a sequence of 0 can never be submitted.
  if (tx.sequence !== '0') throw new Sep10Error('sep10.error.sequence');

  // The challenge is sourced by the SERVER. One sourced by us would be a transaction
  // against our own account with our own signature on it, which is the thing to refuse.
  //
  // A MUXED source (`M…`) is refused outright rather than compared: it wraps an underlying
  // `G…` account, so `tx.source === expect.account` is false even when the underlying
  // account is ours — and since an operation with no source of its own inherits the
  // transaction's, one `M` prefix defeated both this check and the one on the later
  // operations at once. Nothing in SEP-10 needs a muxed source; sequence 0 was left
  // carrying the whole file on its own.
  if (tx.source.startsWith('M')) throw new Sep10Error('sep10.error.ourSource');
  if (tx.source === expect.account) throw new Sep10Error('sep10.error.ourSource');

  // And when the server publishes which key that is, it must BE that key. Everything else
  // here establishes that the challenge is harmless to sign; this is the only check that
  // establishes who is asking. Skipped when no TOML named a key, never defaulted.
  if (expect.signingKey && tx.source !== expect.signingKey) throw new Sep10Error('sep10.error.signingKey');

  if (tx.memo && tx.memo.type !== 'none') throw new Sep10Error('sep10.error.memo');

  const ops = tx.operations;
  if (ops.length < 2) throw new Sep10Error('sep10.error.operations');

  for (const op of ops) {
    if (op.type !== 'manageData') throw new Sep10Error('sep10.error.operations');
  }

  const first = ops[0] as { name?: string; value?: unknown; source?: string };
  if (first.source !== expect.account) throw new Sep10Error('sep10.error.notOurs');
  if (first.name !== `${expect.homeDomain} auth`) throw new Sep10Error('sep10.error.homeDomain');

  // The nonce is what makes one challenge unusable as another. A short or absent one is a
  // server reusing bytes, and a challenge with no entropy is a standing signature.
  const nonce = utf8(first.value);
  let decoded: number;
  try {
    decoded = atob(nonce).length;
  } catch {
    decoded = 0;
  }
  if (decoded !== NONCE_BYTES) throw new Sep10Error('sep10.error.nonce');

  // Every later operation belongs to the server, not to us: one sourced by our account is
  // a data entry being written on it under cover of a login. An operation that sets NO
  // source inherits the transaction's, so that is what is compared — reading only the
  // explicit field meant an inherited source was never checked at all.
  let webAuth: string | null = null;
  for (const raw of ops.slice(1)) {
    const op = raw as { name?: string; value?: unknown; source?: string };
    if ((op.source ?? tx.source) === expect.account) throw new Sep10Error('sep10.error.extraOnUs');
    if (op.name === 'web_auth_domain') webAuth = utf8(op.value);
  }
  if (webAuth === null) throw new Sep10Error('sep10.error.noWebAuthDomain');
  if (webAuth !== expect.webAuthDomain) throw new Sep10Error('sep10.error.webAuthDomain');

  /* The window. A challenge with none is a signature with no end date. */
  const bounds = tx.timeBounds;
  if (!bounds) throw new Sep10Error('sep10.error.noWindow');
  const min = Number(bounds.minTime);
  const max = Number(bounds.maxTime);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) throw new Sep10Error('sep10.error.noWindow');
  if (max + CLOCK_SKEW_S < now) throw new Sep10Error('sep10.error.expired');
  if (min > now + CLOCK_SKEW_S) throw new Sep10Error('sep10.error.notYetValid');
  if (max - now > MAX_WINDOW_S + CLOCK_SKEW_S) throw new Sep10Error('sep10.error.window');

  return tx;
}

/**
 * Check a challenge and sign it.
 *
 * `secret` is fetched per signature by the store and never held; this returns the signed
 * envelope and keeps nothing.
 *
 * `accountSigners` is what the LEDGER says may sign for the account (weight above 0). A
 * recovered account is signed for by a key that is not its master — SEP-10 verifies a
 * challenge against the account's current signers, not its address — so requiring the
 * master refused every recovered wallet. The check stays: a key that is neither the master
 * nor a signer would produce a token the server refuses anyway, and saying so here names
 * the actual problem.
 */
export function signChallenge(
  cfg: NetConfig,
  xdr: string,
  expect: ChallengeExpectation,
  secret: string,
  accountSigners: readonly string[],
): string {
  const tx = assertSafeChallenge(cfg, xdr, expect);
  const kp = Keypair.fromSecret(secret);
  const key = kp.publicKey();
  if (key !== expect.account && !accountSigners.includes(key)) throw new Sep10Error('sep10.error.wrongKey');
  tx.sign(kp);
  return tx.toXDR();
}

/** What a challenge says about who is asking, read off its own operations. */
export interface ChallengeClaim {
  /** The first operation's `<home domain> auth`: the service the login is for. */
  homeDomain: string;
  /** `web_auth_domain`: the host that minted the challenge. */
  webAuthDomain: string;
}

/** SEP-10 names the first operation `<home domain> auth`. */
const AUTH_SUFFIX = ' auth';

/**
 * A bare host — letters, digits, dots and hyphens, an optional port — and nothing a URL
 * could read as a path, credentials or a second host. The home domain is put into
 * `https://<domain>/.well-known/stellar.toml`, so `evil.example/x` or `a@b` must not pass.
 */
export function isChallengeDomain(value: string): boolean {
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(value)) return false;
  try {
    return new URL(`https://${value}`).host === value.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Whether a pasted envelope has SEP-10's shape, and if so who it claims to come from.
 *
 * Shape only, and a CLAIM: nothing here is trusted. It is what lets the manual signing
 * screen route a challenge to `lib/webAuth.ts`, which checks the claim against the
 * domain's own `stellar.toml` and then runs `assertSafeChallenge` in full. Null for
 * anything that is not one: a sequence other than 0, an operation that is not
 * `manageData`, a first operation not named `<domain> auth`, no `web_auth_domain`.
 */
export function challengeClaimOf(cfg: NetConfig, xdr: string): ChallengeClaim | null {
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(xdr.trim(), cfg.passphrase);
  } catch {
    return null;
  }
  if (tx instanceof FeeBumpTransaction || tx.sequence !== '0') return null;
  const ops = tx.operations;
  if (ops.length < 2 || ops.some((op) => op.type !== 'manageData')) return null;
  const name = (ops[0] as { name?: string }).name ?? '';
  if (!name.endsWith(AUTH_SUFFIX)) return null;
  const homeDomain = name.slice(0, -AUTH_SUFFIX.length);
  const web = ops.slice(1).find((op) => (op as { name?: string }).name === 'web_auth_domain') as { value?: unknown } | undefined;
  if (!web) return null;
  const webAuthDomain = utf8(web.value);
  if (!isChallengeDomain(homeDomain) || !isChallengeDomain(webAuthDomain)) return null;
  return { homeDomain, webAuthDomain };
}

/**
 * Refuse a challenge that `signingKey` did not sign.
 *
 * `assertSafeChallenge` checks the challenge is SOURCED by the published key; SEP-10 also
 * has the server sign it, and a client is to verify that signature. Sourcing is a field
 * anyone can write; the signature is what only the key's holder can produce.
 */
export function assertServerSigned(tx: Transaction, signingKey: string): void {
  const kp = Keypair.fromPublicKey(signingKey);
  const hint = kp.signatureHint();
  const hash = tx.hash();
  const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
  const signed = tx.signatures.some((s) => {
    const sigHint = signatureField(s, 'hint');
    const sig = signatureField(s, 'signature');
    return !!sigHint && !!sig && sameBytes(sigHint, hint) && kp.verify(hash, sig as Buffer);
  });
  if (!signed) throw new Sep10Error('sep10.error.serverSignature');
}

/**
 * A `DecoratedSignature` field's bytes. stellar-sdk 17 holds each field as a readonly
 * property wrapping the bytes (`.value`); older releases exposed accessor methods — the
 * same tolerance `hintOf` in `lib/txGuard.ts` has. Anything else is null, never a guess.
 */
function signatureField(sig: unknown, name: 'hint' | 'signature'): Uint8Array | null {
  const field = (sig as Record<string, unknown> | null)?.[name];
  const raw = typeof field === 'function' ? (field as () => unknown).call(sig) : field;
  const bytes = raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw;
  return bytes instanceof Uint8Array ? bytes : null;
}

/** The host a base URL presents, which is what its challenges must name. */
export function webAuthDomainOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return '';
  }
}
