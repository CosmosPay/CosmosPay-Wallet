/**
 * Runtime contracts for the Pollar bridge and for Pollar's own SDK API.
 *
 * Same rules as `cosmospayShapes.ts`: assert only what the wallet acts on, let unknown
 * keys through, and pass the contract as a required argument so a new call cannot opt
 * out. What is different is who is on the other end. The bridge is ours; Pollar is a
 * third party that custodies the user's key, and the two fields this file is strictest
 * about are the ones where a wrong value costs the user money:
 *
 *   - `signedXdr`, which comes back from a party that just signed with a key the wallet
 *     does not hold. The contract asserts it is base64; `pollarApi.verifySignedXdr` is
 *     what asserts it is a signature over the transaction we actually sent.
 *   - `address`, the Stellar account a session claims. It is checked as a real `G…`
 *     rather than a string, because the wallet turns it into a receive QR — an address
 *     that is subtly wrong is funds sent nowhere, and nothing later in the flow looks
 *     at it again.
 */
import { account, arrayOf, bool, id, nullable, num, object, optional, str, unchecked, variant, xdr, type Check } from '@/lib/apiShape';

/* ------------------------------- the bridge ------------------------------ */

/**
 * `POST /v1/pollar/oauth/authorize`.
 *
 * `authorization_url` is asserted as a plain string here and validated as an https URL
 * in `lib/pollar.ts` before it is handed to the OS opener. Shape and safety are
 * different questions, and the second one belongs at the boundary the URL crosses —
 * the same split `openExternal` already makes.
 */
export const PollarAuthorizationShape = object({
  state: id,
  authorization_url: str,
  provider: str,
  redirect_uri: nullable(str),
  expires_at: unchecked,
});

/**
 * `GET /v1/pollar/oauth/sessions/{state}`.
 *
 * A discriminated union on `status`, so an unrecognised status throws instead of
 * falling through a `switch` default. That matters more here than usual: the wallet
 * polls this in a loop, and a status it does not understand must stop the loop rather
 * than be read as "still pending" forever.
 *
 * `code` is asserted only on the `authorized` arm, which is the only one that carries
 * it — the bridge mints a fresh code on each poll and retires the previous one, so a
 * code appearing on any other status would mean the contract has drifted.
 */
export const PollarSessionStatusShape = variant('status', {
  pending: object({ state: id }),
  authorized: object({ state: id, code: id, code_expires_at: unchecked }),
  exchanging: object({ state: id }),
  consumed: object({ state: id }),
  failed: object({ state: id, error_code: optional(nullable(str)) }),
  expired: object({ state: id }),
});

/** A wallet on a Pollar session. `address` is null until Pollar has provisioned one. */
export const PollarWalletShape = object({
  type: str,
  address: nullable(account),
  chain: optional(str),
  exists_on_stellar: optional(bool),
  funding_mode: optional(str),
  network: optional(str),
});

/**
 * `POST /v1/pollar/oauth/token` — the redemption.
 *
 * `publishable_key` and `api_base_url` are asserted because the wallet does not merely
 * display them: every later call to Pollar is addressed and authenticated with them.
 * An absent `api_base_url` read as `undefined` would build the request URL
 * `undefined/tx/sign`, and the wallet would report "could not reach Pollar" for a
 * response that arrived perfectly well.
 */
export const PollarSessionShape = object({
  access_token: str,
  refresh_token: str,
  token_type: str,
  expires_at: num,
  user_id: nullable(str),
  wallet: PollarWalletShape,
  wallets: arrayOf(PollarWalletShape),
  profile: unchecked,
  publishable_key: id,
  api_base_url: str,
});

/** `POST /v1/pollar/oauth/refresh`. Same tokens, nothing else changed. */
export const PollarTokenPairShape = object({
  access_token: str,
  refresh_token: str,
  token_type: str,
  expires_at: num,
});

export const PollarLogoutShape = object({ revoked: num });

/** `POST /v1/pollar/wallets/activate`. `amount` is XLM funded, `activated` false on a repeat. */
export const PollarActivationShape = object({
  public_key: account,
  amount: str,
  activated: bool,
});

/** `POST /v1/pollar/wallets/{address}/trustlines[/default]`. */
export const PollarTrustlineShape = object({ code: str });

/* ------------------------------ Pollar direct ---------------------------- */

/**
 * Pollar wraps every response as `{ success, code, content }`. The envelope is
 * asserted separately from its content so a failure — which carries `success: false`
 * and no `content` — produces a Pollar error with its own code rather than an
 * ApiShapeError complaining that `content` is missing. The code is what the wallet
 * branches on; the message is for the user.
 */
export const PollarEnvelopeShape = object({ code: str });

/** `POST /v2/tx/sign` content. The signature the wallet is about to submit. */
export const PollarSignedShape = object({
  signedXdr: xdr,
  idempotencyKey: optional(str),
  sponsored: optional(bool),
});

/** `POST /v2/tx/submit` content. */
export const PollarSubmitShape = object({
  hash: str,
  status: str,
  resultCode: optional(str),
  message: optional(str),
});

export type PollarShape = Check<unknown>;
