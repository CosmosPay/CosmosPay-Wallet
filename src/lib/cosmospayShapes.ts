/**
 * Runtime contracts for every CosmosPay gateway response.
 *
 * One contract per endpoint, passed as a REQUIRED argument to the transport helpers
 * in `cosmospay.ts` — so an endpoint added later cannot silently go unvalidated the
 * way a `as T` cast always could.
 *
 * Each contract asserts only the fields the wallet acts on: ids it puts back into a
 * URL, amounts it shows or compares, and above all `xdr`, which it signs. Everything
 * else passes through untouched, because installed wallets run weeks behind the
 * server and a contract that rejected a newly-added field would brick a release for
 * no security gain. See the header of `lib/apiShape.ts` for that reasoning.
 *
 * These have NOT been exercised against the live gateway — they encode the shapes
 * declared in `cosmospay.ts`. If one fires in production, the fix is to loosen the
 * offending field here, not to remove the check.
 */
import {
  account,
  amount,
  arrayOf,
  bool,
  either,
  id,
  nullable,
  num,
  object,
  optional,
  str,
  unchecked,
  variant,
  xdr,
  type Check,
} from '@/lib/apiShape';

/* --------------------------- provisioning ------------------------------ */

const Keys = object({ dev: nullable(str), prod: nullable(str) });

export const RegisterResultShape = variant('status', {
  pending: object({ claimToken: id, expiresInSeconds: num }),
  exists: object({}),
});

export const ClaimResultShape = variant('status', {
  pending: object({}),
  ready: object({ organizationId: id, keys: Keys }),
  claimed: object({}),
  expired: object({}),
});

export const LinkStartResultShape = variant('status', {
  sent: object({ claimToken: id, expiresInSeconds: num }),
  not_found: object({}),
});

export const LinkVerifyResultShape = variant('status', {
  ready: object({ organizationId: id, keys: Keys }),
  invalid: object({ attemptsLeft: num }),
  expired: object({}),
  locked: object({}),
});

/* ------------------------------- swaps --------------------------------- */

export const SwapQuoteShape = object({
  source: object({ amount }),
  fee: object({ amount, bps: num, asset: str }),
  destination: object({ estimated: amount, minimum: amount, asset: str, slippageBps: num }),
});

/** `xdr` is the field that gets signed — the strictest check in this file. */
export const SwapShape = object({
  id,
  xdr,
  source: account,
  sendAmount: amount,
  sendAsset: str,
  destEstimated: amount,
  destAsset: str,
});

export const SubmitResultShape = object({
  submitted: bool,
  txHash: nullable(str),
  reason: nullable(str),
  resultCodes: unchecked,
});

/* ----------------------------- liquidity -------------------------------- */

const Reserve = object({ asset: str, issuer: nullable(str), amount });

export const LiquidityPoolShape = object({
  id,
  feeBp: num,
  totalShares: str,
  reserves: arrayOf(Reserve),
});

export const LiquidityPoolListShape = object({
  data: arrayOf(LiquidityPoolShape),
  cursor: nullable(str),
});

export const LiquidityPositionShape = object({
  poolId: id,
  shares: str,
  shareOfPoolBps: num,
  reserves: arrayOf(Reserve),
  redeemable: arrayOf(Reserve),
});

export const LiquidityPositionListShape = object({ data: arrayOf(LiquidityPositionShape) });

/** Signed locally — `xdr` and the amounts are what the user is committing to. */
export const LiquidityOperationShape = object({
  id,
  xdr,
  source: account,
  amountA: amount,
  amountB: amount,
  shares: nullable(str),
});

export const LiquiditySubmitResultShape = object({
  submitted: bool,
  txHash: optional(str),
  reason: optional(str),
});

/* ------------------------------ pay links ------------------------------- */

export const PayIntentShape = object({
  id,
  uri: str,
  qr: str,
  asset: str,
  amount: nullable(str),
});

/* --------------------------------- KYC ---------------------------------- */

export const ReceiverShape = object({ id, email: str, country: str });

/**
 * A list page, or a bare array from an older gateway.
 *
 * Every `/v1` list now answers `{ data, total, take, skip }` and clamps the page at
 * 100. `total` is asserted as a number because the wallet ACTS on it — it is what
 * tells a screen the page it is showing is not the whole set, and a string there
 * would compare wrong rather than throw. It stays `optional` so a gateway that
 * predates pagination still parses; `getPage` falls back to `data.length` and the
 * caller sees a total that is at least not a lie about the rows it has.
 *
 * The bare-array branch is kept for the same reason the contracts are lenient about
 * unknown keys: installed wallets run weeks behind the server, and here they can also
 * run *ahead* of it — an app-store build reaches a gateway that has not been deployed
 * yet, and refusing the older shape would brick the KYC screens for that window.
 */
function pageOf<T>(row: Check<T>): Check<T[] | { data?: T[]; total?: number }> {
  return either(arrayOf(row), object({ data: optional(arrayOf(row)), total: optional(num) }));
}

export const ReceiverListShape = pageOf(ReceiverShape);

export const RegisteredWalletShape = object({ id, network: str });
export const RegisteredWalletListShape = pageOf(RegisteredWalletShape);

export const SignMessageShape = object({ message: str });
export const TosShape = object({ url: optional(str) });

export const BankAccountShape = object({ id });
export const BankAccountListShape = pageOf(BankAccountShape);

/* -------------------------- onramp / offramp ---------------------------- */

/** Minor units — `toMinor`/`fmtMinor` do integer arithmetic on these. */
export const PayinQuoteShape = object({
  id,
  sender_amount: optional(num),
  receiver_amount: optional(num),
});

export const PayinShape = object({ id });

export const PayoutQuoteShape = object({
  id,
  sender_amount: optional(num),
  receiver_local_amount: optional(num),
  receiver_amount: optional(num),
});

/**
 * Forwarded verbatim from BlindPay with no fixed field name, so the only thing that
 * can be asserted here is "an object". `extractUnsignedXdr` then digs the envelope
 * out of it and `lib/txGuard.ts` decides whether it is safe to sign — that guard,
 * not this contract, is what protects the payout path.
 */
export const AuthorizePayoutShape: Check<unknown> = object({});

export const PayoutShape = object({ id });

/* --------------------------- operation history --------------------------- */

/**
 * The gateway's record of what the wallet asked it to do.
 *
 * These are READ contracts, and they are looser than the write ones on purpose. The
 * wallet acts on a swap's `xdr` when it creates one, so `SwapShape` above asserts it
 * strictly; a row in a history list is something the wallet renders, and the worst a
 * wrong field can do here is show a wrong label. Asserting `xdr` on a settled swap
 * would mean a row the gateway has since pruned the envelope from takes the whole
 * screen down with an ApiShapeError.
 *
 * What IS asserted is `id` — because the screen puts it back in a URL to open the
 * detail — and `status`, because the screen branches on it.
 */
export const SwapRowShape = object({
  id,
  status: str,
  sendAsset: str,
  sendAmount: amount,
  destAsset: str,
  destEstimated: amount,
  txHash: optional(nullable(str)),
  createdAt: unchecked,
});
export const SwapListShape = pageOf(SwapRowShape);

/** A fiat deposit. Amounts are MINOR units here, as BlindPay reports them. */
export const PayinRowShape = object({
  id,
  status: optional(nullable(str)),
  token: optional(nullable(str)),
  paymentMethod: optional(nullable(str)),
  senderAmount: optional(nullable(num)),
  receiverAmount: optional(nullable(num)),
  createdAt: unchecked,
});
export const PayinListShape = pageOf(PayinRowShape);

/** A fiat withdrawal. Same minor-unit caveat as a payin. */
export const PayoutRowShape = object({
  id,
  status: optional(nullable(str)),
  token: optional(nullable(str)),
  rail: optional(nullable(str)),
  senderAmount: optional(nullable(str)),
  receiverAmount: optional(nullable(num)),
  createdAt: unchecked,
});
export const PayoutListShape = pageOf(PayoutRowShape);

/** A liquidity deposit or withdrawal. `kind` is what the row is labelled by. */
export const LiquidityOpRowShape = object({
  id,
  kind: str,
  status: str,
  poolId: id,
  assetA: str,
  assetB: str,
  amountA: amount,
  amountB: amount,
  txHash: optional(nullable(str)),
  createdAt: unchecked,
});
export const LiquidityOpListShape = pageOf(LiquidityOpRowShape);

/* ------------------------- deposits: trustline + VA ----------------------- */

/**
 * `POST /v1/onramp/trustline` — an unsigned envelope the wallet signs.
 *
 * Back to the strict `xdr` check, and for the reason the loose ones above are loose:
 * this one gets signed. `txGuard` still decides whether it is safe; this only stops
 * the obvious garbage reaching it.
 */
export const TrustlineTxShape = object({ xdr });

/** A permanent bank account for recurring deposits. Fields vary by rail. */
export const VirtualAccountShape = object({ id });
export const VirtualAccountListShape = pageOf(VirtualAccountShape);

/**
 * `GET /v1/kyc/rails` and `/v1/kyc/bank-details`.
 *
 * Both are BlindPay passthroughs whose content shape BlindPay does not publish, so
 * `unchecked` is the honest contract rather than a guessed one — see `normalizeRails`
 * in `lib/fiatRails.ts`, which is where the guessing is done explicitly, in one place,
 * with the local table as the fallback when it does not recognise what came back.
 */
export const RailsShape: Check<unknown> = unchecked;
