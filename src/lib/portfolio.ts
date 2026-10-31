/** Turn raw Horizon balances + a price map into display rows + a USD total. */
import type { AccountState, PriceInfo } from '@/lib/stellar';
import { findRegistryAsset, registrySnapshot } from '@/lib/assetRegistry';
import { fromMinorUnits } from '@/lib/amount';
import { CHAIN_TOKENS_BY_NET, OTHER_CHAINS, type ChainNet, type OtherChain } from '@/constants/chains';
import { NETWORKS, NETWORK_IDS, type NetworkId, type NetworkToken } from '@/constants/networks';
import type { CrossChainAsset } from '@/lib/cosmospay';

export interface AssetRow {
  code: string;
  issuer: string | null;
  amount: number;
  price: number | null; // USD per unit, null when unknown
  value: number | null; // amount * price, null when unknown
  isNative: boolean;
  /** Set on a Solana / Monad holding; absent on a Stellar one. */
  chain?: OtherChain;
  /** Set on a holding on any other network (`networkRows`). */
  network?: NetworkId;
  /** The token on `chain`: `native`, or its SPL mint / ERC-20 address. */
  asset?: string;
  /** A token the person added (lib/trackedTokens.ts): listed even at zero, like a trustline. */
  added?: boolean;
}

/** A row's identity. A code is not one: USDC on Stellar and USDC on Solana are two rows. */
export const rowKey = (r: AssetRow): string =>
  r.network ? `${r.network}:${r.asset}` : r.chain ? `${r.chain}:${r.asset}` : `${r.code}:${r.issuer ?? ''}`;

/**
 * Base-unit balances of the phrase's Solana and Monad tokens, per chain. A chain whose node
 * could not be read is `null`, and contributes no rows — a zero would read as "emptied".
 */
export type ChainHoldings = Partial<Record<OtherChain, Record<string, bigint> | null>>;

/**
 * Base-unit balances on the networks beyond Stellar, Solana and Monad (`lib/networkBalances.ts`):
 * `native` and each registry token by its asset. A network that could not be read is `null`.
 */
export type NetworkHoldings = Partial<Record<NetworkId, Record<string, bigint> | null>>;

/**
 * Dollar stablecoins on the other chains. Unlike a Stellar code these are safe to price by
 * symbol: `CHAIN_TOKENS_BY_NET` lists only the issuers' canonical contracts, and a balance
 * is only ever read for a contract in that list.
 */
const CHAIN_STABLE = new Set(['USDC', 'USDT', 'USDT0']);

/**
 * The Solana / Monad holdings as portfolio rows: each chain's native coin always (so the
 * account is visible before it is funded), its tokens only when held.
 */
export function chainRows(holdings: ChainHoldings | null, net: ChainNet, prices: Record<string, PriceInfo>): AssetRow[] {
  if (!holdings) return [];
  const rows: AssetRow[] = [];
  for (const chain of OTHER_CHAINS) {
    const balances = holdings[chain];
    if (!balances) continue;
    for (const token of CHAIN_TOKENS_BY_NET[net][chain]) {
      const units = balances[token.asset] ?? 0n;
      const native = token.asset === 'native';
      if (!native && units === 0n) continue;
      const amount = parseFloat(fromMinorUnits(units, token.decimals) ?? '0') || 0;
      const price = prices[token.symbol]?.usd ?? (CHAIN_STABLE.has(token.symbol) ? 1 : null);
      rows.push({
        code: token.symbol,
        issuer: null,
        amount,
        price,
        value: price !== null ? amount * price : null,
        isNative: false,
        chain,
        asset: token.asset,
      });
    }
  }
  return rows;
}

/** A token's USD price as NEAR Intents lists it, by network and contract (`native` for the coin). */
export type IntentsPriceOf = (network: NetworkId, asset: string) => number | null;

export function intentsPriceOf(list: readonly CrossChainAsset[] | null): IntentsPriceOf {
  const byKey = new Map<string, number>();
  for (const a of list ?? []) {
    if (typeof a.priceUsd !== 'number' || !Number.isFinite(a.priceUsd) || a.priceUsd < 0) continue;
    const asset = a.contract === null ? 'native' : a.contract.toLowerCase();
    // the coin's own entry only, not a wrapped coin listed without a contract ("BTC(OMNI)")
    if (a.contract === null && a.symbol !== NETWORKS[a.chain as NetworkId]?.coin) continue;
    byKey.set(`${a.chain}:${asset}`, a.priceUsd);
  }
  return (network, asset) => byKey.get(`${network}:${asset === 'native' ? asset : asset.toLowerCase()}`) ?? null;
}

/**
 * The holdings on every other network as portfolio rows — only what is held: thirty networks of
 * zero coins would bury the ones that matter. Stablecoins are the registry's canonical contracts,
 * so pricing them at $1 is safe; a coin without a live price shows its amount and adds nothing.
 *
 * `tracked` are the tokens the person added (lib/trackedTokens.ts): listed with the registry's,
 * and on Solana and Monad — whose coin and registry tokens are `chainRows`' — alone. An added
 * token is priced ONLY by NEAR Intents' price for that contract: never by its symbol and never
 * at parity, because a token calling itself USDC is not the registry's USDC.
 */
export function networkRows(
  holdings: NetworkHoldings | null,
  prices: Record<string, PriceInfo>,
  opts: { tracked?: Partial<Record<NetworkId, readonly NetworkToken[]>>; priceOf?: IntentsPriceOf } = {},
): AssetRow[] {
  if (!holdings) return [];
  const rows: AssetRow[] = [];
  for (const id of NETWORK_IDS) {
    const balances = holdings[id];
    if (!balances) continue;
    const def = NETWORKS[id];
    const added = opts.tracked?.[id] ?? [];
    const own = id === 'solana' || id === 'monad' ? [] : [{ symbol: def.coin, asset: 'native', decimals: def.decimals }, ...def.tokens];
    for (const token of [...own, ...added]) {
      const units = balances[token.asset] ?? 0n;
      const isAdded = !own.includes(token);
      // An added token was asked for: it shows at zero too, like a Stellar trustline.
      if (units === 0n && !isAdded) continue;
      const amount = parseFloat(fromMinorUnits(units, token.decimals) ?? '0') || 0;
      const price = isAdded
        ? opts.priceOf?.(id, token.asset) ?? null
        : prices[token.symbol]?.usd ?? (CHAIN_STABLE.has(token.symbol) ? 1 : null) ?? opts.priceOf?.(id, token.asset) ?? null;
      rows.push({
        code: token.symbol,
        issuer: null,
        amount,
        price,
        value: price !== null ? amount * price : null,
        isNative: false,
        network: id,
        asset: token.asset,
        ...(isAdded ? { added: true } : {}),
      });
    }
  }
  return rows;
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
  /** Holdings on the phrase's other chains (`chainRows`), counted in the same total. */
  extra: AssetRow[] = [],
): { total: number; rows: AssetRow[]; changePct: number; deltaUsd: number } {
  const stellarRows: AssetRow[] = !account || !account.balances.length ? [nativeRow(prices)] : account.balances.map((b) => {
    const amount = parseFloat(b.balance) || 0;
    let price: number | null = prices[b.code]?.usd ?? null;
    // Parity is assumed only for a stablecoin from its recognised issuer.
    if (price === null && STABLE.has(b.code) && isTrustedStableIssuer(b.code, b.issuer, networkId)) price = 1;
    const value = price !== null ? amount * price : null;
    return { code: b.code, issuer: b.issuer, amount, price, value, isNative: b.isNative };
  });
  const rows = [...stellarRows, ...extra];
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
