/**
 * Pure money-decision logic.
 *
 * Every function here decides whether a send / swap / LP deposit / LP withdraw /
 * off-ramp amount is acceptable. Screens call them to enable their buttons; the
 * store re-checks the SAME function before signing or submitting — a disabled
 * button is a hint, not an enforcement point.
 *
 * No DOM, no store hook, no storage: these are plain functions over plain
 * numbers/strings, so they run under node:test (see tests/unit/money.test.ts).
 * This is the structural half of the fix: money rules stay OUT of the store hook
 * so a regression in a money path fails fast in CI instead of shipping.
 */
import { isValidAmount, isAmountWithin, isValidFiatAmount, isValidMemo } from '@/lib/validation';
import { isValidPublicKey } from '@/lib/wallet';

/** XLM spendable after the account's base reserve (+ a small fee buffer). */
export function spendableXlm(xlm: number, subentryCount: number): number {
  const minBalance = (2 + subentryCount) * 0.5; // base reserve (2 entries + 0.5 XLM each)
  return Math.max(0, xlm - minBalance - 0.001);
}

/** Spendable balance of an asset: XLM is reserve-aware, credit assets use the raw balance. */
export function availableBalance(
  code: string,
  isNative: boolean,
  balance: string,
  xlm: number,
  subentryCount: number,
): number {
  return isNative || code === 'XLM' ? spendableXlm(xlm, subentryCount) : parseFloat(balance) || 0;
}

/* --------------------------------- send -------------------------------- */

export interface SendDecision {
  addressValid: boolean;
  amountValid: boolean;
  memoValid: boolean;
  ok: boolean;
}

/** Decide whether a send draft (to + amount + memo) is submittable. */
export function decideSend(to: string, amount: string, memo: string, available: number): SendDecision {
  const addressValid = isValidPublicKey(to.trim());
  const amountValid = isAmountWithin(amount, available);
  const memoValid = isValidMemo(memo);
  return { addressValid, amountValid, memoValid, ok: addressValid && amountValid && memoValid };
}

/* --------------------------------- swap -------------------------------- */

export interface SwapDecision {
  insufficient: boolean;
  ok: boolean;
}

/** Decide whether a swap (pay amount vs the source balance) is submittable. */
export function decideSwap(pay: string, available: number, sameAsset: boolean): SwapDecision {
  const amountValid = isValidAmount(pay);
  const insufficient = amountValid && Number(pay) > available;
  return { insufficient, ok: amountValid && !sameAsset && !insufficient };
}

/* --------------------------- liquidity deposit ------------------------- */

export interface LpDepositDecision {
  overA: boolean;
  overB: boolean;
  ok: boolean;
}

/** Decide whether an LP deposit pair is submittable. `amountB` is optional. */
export function decideLpDeposit(
  amountA: string,
  amountB: string | undefined,
  availA: number,
  availB: number,
  sameAsset: boolean,
): LpDepositDecision {
  const aValid = isValidAmount(amountA);
  const overA = aValid && Number(amountA) > availA;
  const bValid = isValidAmount(amountB ?? '');
  const overB = bValid && Number(amountB as string) > availB; // only guards when the user typed one
  return { overA, overB, ok: aValid && !sameAsset && !overA && !overB };
}

/* -------------------------- liquidity withdraw ------------------------- */

export interface LpWithdrawDecision {
  over: boolean;
  ok: boolean;
}

/** Decide whether burning `shares` out of `held` is submittable. */
export function decideLpWithdraw(shares: string, held: number): LpWithdrawDecision {
  const valid = isValidAmount(shares);
  const over = valid && Number(shares) > held;
  return { over, ok: valid && !over };
}

/* --------------------------------- fiat -------------------------------- */

/** Decide whether a fiat on/off-ramp amount is quotable (>= 0.01, within balance). */
export function decideFiatAmount(amount: string, balance: number): { insufficient: boolean; ok: boolean } {
  const valid = isValidFiatAmount(amount);
  const within = isAmountWithin(amount, balance);
  const insufficient = valid && !within;
  return { insufficient, ok: valid && within };
}
