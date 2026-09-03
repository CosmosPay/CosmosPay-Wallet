/**
 * Pollar's own SDK API — the half the bridge deliberately does not proxy.
 *
 * Once a session is redeemed the wallet talks to `https://sdk.api.pollar.xyz/v2`
 * itself, with the session's bearer token and the publishable key. The community
 * server holds no key that could do this and says so in its own header: it is an
 * OAuth bridge, not a wallet proxy.
 *
 * ## Why a Pollar account does not escape `txGuard`
 *
 * A Pollar wallet's key lives in Pollar's KMS, so the wallet cannot sign for it. The
 * obvious integration is `POST /tx/build-sign-submit`: name an operation, and Pollar
 * builds, signs and submits it. That path would hand a third party the whole
 * transaction — what it does, where the value lands, what it costs — with the wallet
 * seeing only a hash afterwards, and CLAUDE.md's first rule about signing is that the
 * wallet does not sign what it has not decoded.
 *
 * So this module uses the SPLIT flow instead, and the split is the entire point:
 *
 *   1. the wallet builds the envelope locally, exactly as it does for a local account;
 *   2. `assertSafeToSign` decodes it and refuses anything outside the intent — before
 *      Pollar is contacted at all;
 *   3. `POST /tx/sign` returns the same envelope with a signature added;
 *   4. {@link verifySigned} proves the signature is over the transaction we sent, by
 *      the account we expect;
 *   5. only then is it submitted — down the settlement path the flow already had, not
 *      Pollar's own, so a Pollar account and a local one report success the same way.
 *
 * Step 4 is not ceremony. Step 3 asks a remote party to sign, and its answer is a
 * fresh envelope of its choosing — nothing in the protocol says the bytes that come
 * back are the bytes that went out. Without the check, a compromised or merely buggy
 * signer could return a valid signature over a *different* transaction and the wallet
 * would submit it, having already shown the user the one it built. The guard would
 * have passed, honestly, on an envelope that never reached the network.
 *
 * What remains outside the wallet's reach, and must stay visible in the UI: Pollar can
 * refuse to sign, and Pollar holds the key. This is a custodial account. The wallet
 * can prove what it submits; it cannot prove what Pollar does with the key otherwise.
 */
import { FeeBumpTransaction, Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { parseShape, type Check } from '@/lib/apiShape';
import { ApiRequestError } from '@/lib/apiError';
import { MAX_FEE_STROOPS } from '@/lib/txGuard';
import type { NetConfig } from '@/lib/stellar';
import { tNow } from '@/lib/i18n';
import type { PollarSession } from '@/lib/pollar';
import { POLLAR_API_KEY_HEADER, POLLAR_TX_SIGN_PATH } from '@/constants/pollar';
import { PollarEnvelopeShape, PollarSignedShape } from '@/lib/pollarShapes';

/**
 * A refusal that happened on the Pollar side of the wire, carrying Pollar's own code.
 *
 * `code` is the stable part of Pollar's contract (`SDK_AUTH_TOKEN_EXPIRED`,
 * `WALLET_ALREADY_FUNDED`, …) and the only thing worth branching on — the message is
 * for the user, and translating a branch is how a wallet silently inverts a check.
 */
export class PollarApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PollarApiError';
    this.status = status;
    this.code = code;
  }
}

/** The signed envelope did not match what was sent. Always terminal, never retried. */
export class PollarSignatureError extends Error {
  readonly reason: 'not-a-transaction' | 'different-transaction' | 'unsigned' | 'wrong-signer' | 'fee-too-high';

  constructor(reason: PollarSignatureError['reason'], message: string) {
    super(message);
    this.name = 'PollarSignatureError';
    this.reason = reason;
  }
}

/* ------------------------------- transport ------------------------------- */

/**
 * One call to Pollar's SDK API.
 *
 * Pollar wraps everything as `{ success, code, content }` with the HTTP status
 * carrying the status, so a failure is recognised two ways — a non-2xx, and a 2xx
 * whose `success` is false. Both are checked: treating only the status as
 * authoritative is how a `success: false` body gets read as content and its missing
 * fields surface later as `undefined` in a signed transaction.
 */
async function callPollar<T>(
  session: PollarSession,
  method: 'POST',
  path: string,
  shape: Check<unknown>,
  body: unknown,
): Promise<T> {
  const url = `${session.api_base_url}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      [POLLAR_API_KEY_HEADER]: session.publishable_key,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  const env = (json ?? {}) as { success?: unknown; code?: unknown; message?: unknown; content?: unknown };
  if (!res.ok || env.success === false) {
    const code = typeof env.code === 'string' ? env.code : `HTTP_${res.status}`;
    const message = typeof env.message === 'string' && env.message ? env.message : tNow('pollar.providerError', { code });
    throw new PollarApiError(res.status, code, message);
  }

  // A 2xx with no `content` is contract drift, not a success: returning it would
  // surface downstream as a missing `signedXdr`, i.e. as a transaction that silently
  // never got signed.
  parseShape(url, PollarEnvelopeShape, json);
  if (env.content === undefined) {
    throw new PollarApiError(res.status, 'NO_CONTENT', tNow('pollar.emptyResponse'));
  }

  parseShape(url, shape, env.content);
  return env.content as T;
}

/* ------------------------------ verification ----------------------------- */

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Prove that `signed` is the transaction in `sent`, signed by `address`.
 *
 * Three separate claims, because each fails differently:
 *
 *  - **Same transaction.** Compared on the transaction HASH, not on the XDR bytes.
 *    The envelope necessarily differs — it has a signature in it now — so a byte
 *    comparison would reject every legitimate answer. The hash covers the network
 *    passphrase and every field a signature commits to, which is exactly the set that
 *    must not have moved.
 *  - **Actually signed, by the right key.** A returned envelope with no new signature
 *    is a submission that will bounce; one signed by some other key is worse, because
 *    it looks fine until the network refuses it. `Keypair.verify` against the wallet's
 *    own address settles both, and it is the check that makes step 3 of the flow
 *    trustworthy rather than merely convenient.
 *  - **A sponsorship wrapper is allowed, but bounded.** Pollar may return the
 *    transaction wrapped in a fee bump when it is paying the fee — that is the feature
 *    that lets a user with no XLM transact at all. A fee bump cannot alter the inner
 *    transaction (the inner hash still has to match) but it can name any fee, so the
 *    same ceiling `txGuard` applies to a transaction's fee applies here. Anything else
 *    about the wrapper is Pollar's business: it is paying.
 */
export function verifySigned(cfg: NetConfig, sentXdr: string, signedXdr: string, address: string): void {
  let sent: ReturnType<typeof TransactionBuilder.fromXDR>;
  let got: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    sent = TransactionBuilder.fromXDR(sentXdr.trim(), cfg.passphrase);
    got = TransactionBuilder.fromXDR(signedXdr.trim(), cfg.passphrase);
  } catch {
    throw new PollarSignatureError('not-a-transaction', tNow('pollar.sigNotATransaction'));
  }

  // Unwrap a sponsorship fee bump, bounding what it may cost before looking inside.
  let inner = got;
  if (got instanceof FeeBumpTransaction) {
    const fee = Number(got.fee);
    if (!Number.isFinite(fee) || fee < 0 || fee > MAX_FEE_STROOPS) {
      throw new PollarSignatureError('fee-too-high', tNow('pollar.sigFeeTooHigh'));
    }
    inner = got.innerTransaction;
  }

  if (sent instanceof FeeBumpTransaction) {
    // Nothing this wallet builds is a fee bump, and the guard refuses one on the way
    // in — so reaching here means the caller passed something it never reviewed.
    throw new PollarSignatureError('not-a-transaction', tNow('pollar.sigNotATransaction'));
  }

  if (hex(inner.hash()) !== hex(sent.hash())) {
    throw new PollarSignatureError('different-transaction', tNow('pollar.sigDifferentTx'));
  }

  const digest = inner.hash();
  const key = Keypair.fromPublicKey(address);
  const signed = inner.signatures.some((s) => {
    try {
      return key.verify(digest, s.signature());
    } catch {
      return false;
    }
  });
  if (!inner.signatures.length) throw new PollarSignatureError('unsigned', tNow('pollar.sigUnsigned'));
  if (!signed) throw new PollarSignatureError('wrong-signer', tNow('pollar.sigWrongSigner'));
}

/* --------------------------------- calls --------------------------------- */

/**
 * Ask Pollar to sign an envelope the wallet built, and prove that it did.
 *
 * A drop-in for `signXdr` from `lib/stellar.ts`: same inputs modulo the credential,
 * same output, and the same contract with its callers — the guard runs at the CALL
 * SITE, before this, exactly as it does for a local account. That symmetry is the whole
 * reason this function exists in this shape. Every money flow in the store already ends
 * in `assertSafeToSign(...); guardSession(epoch); signXdr(...)`, and a Pollar account
 * changes only the third line. Nothing about which envelopes the wallet is willing to
 * put its name to moves because the key moved.
 *
 * It signs and stops. Submission stays where it already was — the CosmosPay gateway for
 * a swap or a payout, Horizon for a plain payment — so a Pollar account travels the same
 * settlement path as a local one and the flows keep one success/failure story instead of
 * two. Pollar's own `/tx/submit` would have been a second one.
 */
export async function pollarSign(cfg: NetConfig, session: PollarSession, unsignedXdr: string): Promise<string> {
  const address = session.wallet.address;
  if (!address) throw new PollarApiError(409, 'NO_WALLET', tNow('pollar.noWallet'));

  const signed = await callPollar<{ signedXdr: string }>(session, 'POST', POLLAR_TX_SIGN_PATH, PollarSignedShape, {
    publicKey: address,
    unsignedXdr,
  });

  verifySigned(cfg, unsignedXdr, signed.signedXdr, address);
  return signed.signedXdr;
}

/**
 * Is this failure one where re-authenticating would help?
 *
 * Exposed as a predicate over Pollar's own codes so no caller is tempted to match on
 * the message. `401` alone is not enough: Pollar answers `403` for a token whose
 * session was revoked elsewhere, which is the same remedy from the user's side.
 */
export function isAuthFailure(e: unknown): boolean {
  if (e instanceof PollarApiError) return e.status === 401 || e.status === 403 || e.code.startsWith('SDK_AUTH_');
  return e instanceof ApiRequestError && (e.status === 401 || e.status === 403);
}
