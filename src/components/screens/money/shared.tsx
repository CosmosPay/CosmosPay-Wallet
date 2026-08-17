import type { WalletStore } from '@/components/store';
import { spendableXlm as moneySpendableXlm } from '@/lib/money';

// Presentational molecules moved to the atomic layer; re-exported here so existing
// `from './shared'` / '@/components/screens/Money' imports keep working unchanged.
export { SwapTokenSelect } from '@/components/molecules/money/SwapTokenSelect';
export { HistoryRow } from '@/components/molecules/money/HistoryRow';
export { GenesisRow } from '@/components/molecules/money/GenesisRow';

/** Reserve-aware XLM spendable balance — delegates to the pure rule in lib/money. */
export function spendableXlm(store: WalletStore): number {
  const acc = store.account;
  if (!acc || !acc.exists) return 0;
  return moneySpendableXlm(acc.xlm, acc.subentryCount);
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
