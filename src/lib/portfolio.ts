/** Turn raw Horizon balances + a price map into display rows + a USD total. */
import type { AccountState, PriceInfo } from '@/lib/stellar';
import { findRegistryAsset, registrySnapshot } from '@/lib/assetRegistry';

export interface AssetRow {
  code: string;
  issuer: string | null;
  amount: number;
  price: number | null; // USD per unit, null when unknown
  value: number | null; // amount * price, null when unknown
  isNative: boolean;
}

// USD-pegged stables assumed at $1 when no live price is available.
// (EURC is euro-pegged, not $1, and we fetch its real price — so it's excluded.)
//
// USDT0 is here because it is USD-pegged and has no CoinGecko entry: without it a
// user holding Tether's Stellar token saw the balance row but a portfolio total
// that ignored it entirely, which reads as "my money is gone" on the one number
// people check after being paid.
const STABLE = new Set(['USDC', 'USD', 'USDT0']);

/**
 * Is this the real issuer of that code on this network?
 *
 * The $1 assumption below is only safe for an asset we recognise. Anyone can issue
 * a token whose code is "USDC"; pricing by code alone meant a worthless look-alike
 * counted, dollar for dollar, toward the portfolio total — which is exactly the
 * number a user checks before believing they were paid.
 *
 * An unknown issuer gets `price: null`, so the row still shows its balance but adds
 * nothing to the total.
 *
 * Answered from the asset registry, which is the one place that decides who issues
 * what. It used to be a second table (`KNOWN_ISSUERS`) maintained by hand next to
 * the registry, and the two had already diverged: the registry gained USDT0 and
 * that table did not, so Tether's token was priced at nothing while the picker
 * three screens away showed it as verified. Two lists answering one question is
 * the failure the registry exists to prevent — it does not get an exception here.
 */
function isTrustedStableIssuer(code: string, issuer: string | null, networkId?: string): boolean {
  if (!issuer || !networkId) return false;
  // `verified` is the identity check. A registry entry that is merely LISTED — we
  // name its issuer but never confirmed who runs it — must not license the $1
  // assumption, which is a claim about what the balance is worth.
  const entry = findRegistryAsset(registrySnapshot(networkId), { code, issuer });
  return !!entry?.verified;
}

/** XLM is the native asset — always show it (0 balance when unfunded), never "no assets". */
function nativeRow(prices: Record<string, PriceInfo>): AssetRow {
  const price = prices.XLM?.usd ?? null;
  return { code: 'XLM', issuer: null, amount: 0, price, value: price !== null ? 0 : null, isNative: true };
}

export function computePortfolio(
  account: AccountState | null,
  prices: Record<string, PriceInfo>,
  /** Needed to tell a real stablecoin issuer from a look-alike. */
  networkId?: string,
): { total: number; rows: AssetRow[]; changePct: number; deltaUsd: number } {
  if (!account || !account.balances.length) {
    return { total: 0, rows: [nativeRow(prices)], changePct: 0, deltaUsd: 0 };
  }
  const rows: AssetRow[] = account.balances.map((b) => {
    const amount = parseFloat(b.balance) || 0;
    let price: number | null = prices[b.code]?.usd ?? null;
    // Parity is assumed only for a stablecoin from its recognised issuer.
    if (price === null && STABLE.has(b.code) && isTrustedStableIssuer(b.code, b.issuer, networkId)) price = 1;
    const value = price !== null ? amount * price : null;
    return { code: b.code, issuer: b.issuer, amount, price, value, isNative: b.isNative };
  });
  // native first, then by value desc
  rows.sort((a, b) => {
    if (a.isNative) return -1;
    if (b.isNative) return 1;
    return (b.value ?? 0) - (a.value ?? 0);
  });
  const total = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  // Whole-portfolio 24h change: back out each asset's value 24h ago from its price
  // change (value / (1 + chg)), then compare totals. Assets without a known change
  // (stables at parity, unknown prices) count as flat.
  const prevTotal = rows.reduce((sum, r) => {
    if (r.value === null) return sum;
    const chg = prices[r.code]?.change24h ?? 0;
    const denom = 1 + chg / 100;
    return sum + (denom > 0.01 ? r.value / denom : r.value);
  }, 0);
  const deltaUsd = total - prevTotal;
  const changePct = prevTotal > 0 ? (deltaUsd / prevTotal) * 100 : 0;
  return { total, rows, changePct, deltaUsd };
}
