import type { TokenBalance } from '@/lib/stellar';
import { STABLES } from '@/constants/fiat';
import { toMinorUnits } from '@/lib/amount';

/* ---- onramp/offramp amount helpers ---- */
/** Minor units (cents) -> "12.34". */
export const fmtMinor = (n?: number | null) => (n == null ? '—' : (n / 100).toFixed(2));
/** Local fiat (minor units) -> whole units, grouped, no centavos (e.g. ARS "15.615"). */
export const fmtFiat = (n?: number | null) => (n == null ? '—' : Math.round(n / 100).toLocaleString('es-AR'));
/**
 * "12.34" -> 1234 minor units (the API takes integer cents).
 * Delegates to the shared parser: this used to be `parseFloat(s) * 100`, which read
 * "1,50" as 1 and asked the API to move 100 cents instead of 150.
 * Unreadable input yields 0, which every caller already gates on (`>= 1`).
 */
export const toMinor = (s: string) => toMinorUnits(s) ?? 0;

/** Trusted stablecoins on the wallet. Keeps only those with a spendable balance when asked.
 *  Takes the balances, not the store — `lib/` must not depend on `state/`. */
export function stableTokens(balances: TokenBalance[] | undefined, withBalance = false): { code: string; balance: number }[] {
  return (balances ?? [])
    .filter((b) => !b.isNative && STABLES.includes(b.code))
    .map((b) => ({ code: b.code, balance: parseFloat(b.balance) || 0 }))
    .filter((b) => (withBalance ? b.balance > 0 : true));
}
