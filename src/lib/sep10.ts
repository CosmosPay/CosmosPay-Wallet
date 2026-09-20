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
 * ## What it is NOT
 *
 * Not a login for the wallet, and not something a dapp can ask for. The only callers are
 * the two recovery servers in `lib/recovery.ts`, and the token it produces can do exactly
 * two things there: register an account for recovery, and change which identities may
 * recover it. Both already require the key this proves.
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
  /** The wallet's domain, as the server reports it in `/api/recovery/info`. */
  homeDomain: string;
  /** THIS server's host. What stops a challenge minted for its sibling being replayed here. */
  webAuthDomain: string;
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
 */
export function signChallenge(cfg: NetConfig, xdr: string, expect: ChallengeExpectation, secret: string): string {
  const tx = assertSafeChallenge(cfg, xdr, expect);
  const kp = Keypair.fromSecret(secret);
  if (kp.publicKey() !== expect.account) throw new Sep10Error('sep10.error.wrongKey');
  tx.sign(kp);
  return tx.toXDR();
}

/** The host a base URL presents, which is what its challenges must name. */
export function webAuthDomainOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return '';
  }
}
