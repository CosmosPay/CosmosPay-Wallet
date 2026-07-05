import type { WalletStore } from '@/components/store';
import { STABLES } from '@/constants/fiat';

/* ---- onramp/offramp amount helpers ---- */
/** Minor units (cents) -> "12.34". */
export const fmtMinor = (n?: number | null) => (n == null ? '—' : (n / 100).toFixed(2));
/** Local fiat (minor units) -> whole units, grouped, no centavos (e.g. ARS "15.615"). */
export const fmtFiat = (n?: number | null) => (n == null ? '—' : Math.round(n / 100).toLocaleString('es-AR'));
/** "12.34" -> 1234 minor units (the API takes integer cents). */
export const toMinor = (s: string) => Math.round((parseFloat(s) || 0) * 100);

/** Trusted stablecoins on the wallet. Keeps only those with a spendable balance when asked. */
export function stableTokens(store: WalletStore, withBalance = false): { code: string; balance: number }[] {
  return (store.account?.balances ?? [])
    .filter((b) => !b.isNative && STABLES.includes(b.code))
    .map((b) => ({ code: b.code, balance: parseFloat(b.balance) || 0 }))
    .filter((b) => (withBalance ? b.balance > 0 : true));
}
