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
/** The gateway returns either a bare array or a `{ data: [...] }` envelope. */
export const ReceiverListShape = either(arrayOf(ReceiverShape), object({ data: optional(arrayOf(ReceiverShape)) }));

export const RegisteredWalletShape = object({ id, network: str });
export const RegisteredWalletListShape = either(
  arrayOf(RegisteredWalletShape),
  object({ data: optional(arrayOf(RegisteredWalletShape)) }),
);

export const SignMessageShape = object({ message: str });
export const TosShape = object({ url: optional(str) });

export const BankAccountShape = object({ id });
export const BankAccountListShape = either(
  arrayOf(BankAccountShape),
  object({ data: optional(arrayOf(BankAccountShape)) }),
);

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
