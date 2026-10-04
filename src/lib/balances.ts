/**
 * Balance maths.
 *
 * These take an `AccountState`, not the store. They used to take `WalletStore`,
 * which made `lib/` depend on `state/` — a lower layer reaching up into a higher
 * one. That inversion is why they could not be unit-tested: reaching them meant
 * constructing the whole 130-key store object.
 */
import type { AccountState, TokenBalance } from '@/lib/stellar';
import { findAsset, type AssetRef } from '@/lib/asset';
import { STELLAR_DECIMALS } from '@/lib/amount';
import { RECOVERY_MIN_SPENDABLE_XLM } from '@/constants/recovery';

/**
 * XLM the wallet can actually spend: the balance minus Stellar's base reserve
 * (0.5 XLM per entry, with the account itself counting as two) and a little slack
 * for the fee. Sending more than this fails with op_underfunded.
 */
export function spendableXlm(account: AccountState | null): number {
  if (!account || !account.exists) return 0;
  const minBalance = (2 + account.subentryCount) * 0.5; // base reserve
  return Math.max(0, account.xlm - minBalance - 0.001);
}

/**
 * XLM still missing before recovery can be turned on — 0 when the account can pay it.
 *
 * The account pays the two signer entries' reserve itself (there is no sponsored path), and
 * keeps a margin for the fees after it. The screens use this to say how much is missing;
 * `enableRecovery` asks it again, on a fresh ledger read, before registering with either
 * server — a disabled button is a hint, and registering first left both servers holding an
 * account whose setup then failed on chain for want of a reserve.
 */
export function recoveryShortfall(account: AccountState | null): number {
  const missing = RECOVERY_MIN_SPENDABLE_XLM - spendableXlm(account);
  return missing > 0 ? Math.ceil(missing * 100) / 100 : 0;
}

/** Assets the wallet can send: native XLM (always present) + any trustline balances. */
export function sendableAssets(account: AccountState | null): TokenBalance[] {
  const list = (account?.balances ?? []).slice();
  // XLM is the native asset — it never depends on a trustline, so it's always available.
  if (!list.some((b) => b.isNative || b.code === 'XLM')) {
    list.unshift({ code: 'XLM', issuer: null, balance: String(account?.xlm ?? 0), isNative: true });
  }
  return list.sort((a, b) => (a.isNative ? -1 : b.isNative ? 1 : 0));
}

/** Spendable amount of one held asset — native XLM keeps its reserve free. */
export function spendableOf(account: AccountState | null, asset: TokenBalance | undefined): number {
  if (!asset) return 0;
  if (asset.isNative) return spendableXlm(account);
  return parseFloat(asset.balance) || 0;
}

/**
 * The same figure as `spendableOf`, resolved by `(code, issuer)` and returned as a
 * decimal string — the shape `lib/txGuard.ts` compares against.
 *
 * It is the ceiling for an amount the user delegated instead of typing: the liquidity
 * deposit form lets the second side be derived from the pool ratio, and a bound the
 * user never stated has to come from somewhere they could see. This is the balance
 * the form prints under that field.
 */
export function spendableCeiling(account: AccountState | null, ref: AssetRef): string {
  const held = findAsset(sendableAssets(account), ref);
  return spendableOf(account, held).toFixed(STELLAR_DECIMALS);
}
