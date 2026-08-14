/** Balance helpers shared by the money screens. The presentational molecules live
 *  under src/components/molecules/money and are imported straight from there. */
import type { WalletStore } from '@/components/store';

export function spendableXlm(store: WalletStore): number {
  const acc = store.account;
  if (!acc || !acc.exists) return 0;
  const minBalance = (2 + acc.subentryCount) * 0.5; // base reserve
  return Math.max(0, acc.xlm - minBalance - 0.001);
}

/** Assets the wallet can send: native XLM (always present) + any trustline balances. */
export function sendableAssets(store: WalletStore) {
  const list = (store.account?.balances ?? []).slice();
  // XLM is the native asset — it never depends on a trustline, so it's always available.
  if (!list.some((b) => b.isNative || b.code === 'XLM')) {
    list.unshift({ code: 'XLM', issuer: null, balance: String(store.account?.xlm ?? 0), isNative: true });
  }
  return list.sort((a, b) => (a.isNative ? -1 : b.isNative ? 1 : 0));
}
