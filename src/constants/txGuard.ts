/**
 * The signing guard's data: which flows exist, which operations each may contain, and
 * every ceiling it enforces.
 *
 * Collected here rather than scattered through `src/lib/txGuard.ts` so the numbers can
 * be read as a set. That is not tidiness — `BOUND_TOLERANCE_BPS` sat at `100n`, a
 * standing 1% skim licence on every swap and off-ramp, under a comment claiming it
 * absorbed 7-decimal rounding, and nobody put those two facts side by side in 800 lines
 * of guard. Changing anything in this file widens what the wallet will sign, so a diff
 * that touches it is a security diff.
 */

/**
 * Which wallet flow is asking for a signature. `dapp` is reviewed, not allowlisted.
 *
 * `send` and `trustline` used to be here with their own `ALLOWED_OPS` rows and no
 * call site: the wallet builds both locally (`sendPayment`, `stellarAddTrustline`)
 * and never routes them through the guard. A dead row in a security allowlist reads
 * as coverage that does not exist, so they are gone until a flow needs them.
 */
export type SignIntent = 'swap' | 'lp-deposit' | 'lp-withdraw' | 'offramp' | 'dapp';

/**
 * Operations that can hand over the account itself, or move value in a way this
 * wallet cannot decode. None of the wallet's own flows ever needs one, so they are
 * refused outright; the dapp path renders them behind a red warning instead of
 * refusing, because legitimate dapps do use them.
 */
export const CRITICAL_OPS: readonly string[] = [
  'setOptions', // can add a signer or zero the master weight -> account takeover
  'accountMerge', // sends the whole balance and deletes the account
  'allowTrust',
  'setTrustLineFlags',
  'clawback',
  'clawbackClaimableBalance',
  'beginSponsoringFutureReserves',
  'endSponsoringFutureReserves',
  'revokeSponsorship',
  // Soroban. The wallet decodes the contract id and the function name and nothing
  // else, so it cannot tell "read a price" from "transfer my whole USDC balance"
  // through the asset's SAC. Unknown intent over a value-bearing interface is the
  // same risk class as handing over a signer.
  'invokeHostFunction',
  // Moves the balance out to someone else's claim, and the approval window used to
  // render it as a friendly label with no rows at all — a total drain shown as an
  // empty line.
  'createClaimableBalance',
  // Cannot take funds, but a bump to INT64_MAX makes the account permanently
  // unusable: no later transaction can ever reach a higher sequence number.
  'bumpSequence',
];

/**
 * Operations each internal flow may legitimately contain.
 *
 * `manageSellOffer` / `manageBuyOffer` / `createPassiveSellOffer` were removed from
 * `swap`: the gateway builds swaps as path payments, the wallet has no order-book
 * UI, and an offer's cost is a price ratio rather than a settled amount — so no
 * bound the user confirmed could be enforced against one. If a flow ever needs an
 * offer it gets its own entry with its own bound, not a hole in this one.
 */
export const ALLOWED_OPS: Record<Exclude<SignIntent, 'dapp'>, readonly string[]> = {
  swap: ['pathPaymentStrictSend', 'pathPaymentStrictReceive', 'changeTrust'],
  'lp-deposit': ['liquidityPoolDeposit', 'changeTrust'],
  'lp-withdraw': ['liquidityPoolWithdraw', 'changeTrust'],
  offramp: ['payment', 'pathPaymentStrictSend', 'pathPaymentStrictReceive'],
};

/**
 * Fee ceiling for the internal flows, in stroops (1 XLM). Base fee is 100 stroops
 * per operation, so this is ~5 orders of magnitude of headroom — it exists only to
 * stop a fee-drain envelope, not to second-guess congestion pricing.
 */
export const MAX_FEE_STROOPS = 10_000_000;

/**
 * Operation ceiling for the internal flows. Stellar allows 100 per transaction; the
 * fattest thing any of these flows builds is a trustline plus a settlement, so this
 * is already generous. Without it the per-asset total below would still hold, but a
 * hundred-operation envelope is by itself evidence the gateway is not doing what the
 * screen said.
 */
export const MAX_OPS = 8;

/**
 * How long a server-built envelope may stay signable, in seconds.
 *
 * An envelope with no `maxTime` never expires: the counterparty submits these, so it
 * can hold a valid signature and send it when the market has moved. Stellar's replay
 * protection is the sequence number, which only helps once the account has moved on.
 * These flows broadcast within seconds, so fifteen minutes is already generous — the
 * first version allowed 24 hours, which is 24 hours of free optionality handed to
 * the counterparty on a quote that expired in seconds.
 */
export const MAX_VALIDITY_S = 15 * 60;

/**
 * Clock skew tolerated at BOTH ends of the window, in seconds.
 *
 * `Date.now()` on a phone is not NTP-disciplined. Applying the allowance only to the
 * expiry test meant a device running three minutes fast rejected every envelope the
 * gateway ever sent, with a message blaming the server. It is added to the expiry
 * check and to the validity budget alike.
 */
export const CLOCK_SKEW_S = 5 * 60;

/**
 * Rounding tolerance on the confirmed bounds, in basis points.
 *
 * Do the arithmetic before widening this. Stellar carries 7 decimals, so rounding a
 * quote to the nearest stroop moves it by at most 1e-7 of a whole unit — 0.00001 bps
 * on a 1-unit trade. 10 bps is already four orders of magnitude of headroom, enough
 * to still cover amounts down to ~0.001 units.
 *
 * It was 100n (1%) with this same comment, which the arithmetic never supported: a
 * gateway that quotes honestly and settles 0.99% short passes every check here, on
 * every swap and every off-ramp, forever. A tolerance is for rounding; anything wide
 * enough to hide a fee is a fee the user never confirmed.
 */
export const BOUND_TOLERANCE_BPS = 10n; // 0.1%

