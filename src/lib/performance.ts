/**
 * The Performance panel's arithmetic: how the portfolio splits by asset and by network,
 * and what moved today. Pure — the panel renders what this returns, and
 * `tests/unit/performance.test.ts` pins the rules.
 */
import { NATIVE_SYMBOL, type OtherChain } from '@/constants/chains';
import type { AssetRow } from '@/lib/portfolio';
import type { PriceInfo } from '@/lib/stellar';

/** How many assets the split names before folding the rest into "other". */
export const ALLOCATION_SLICES = 5;

export interface Slice {
  key: string;
  /** The asset code, or `…` for the folded remainder. */
  code: string;
  value: number;
  /** 0…1 of the priced total. */
  share: number;
}

/**
 * The priced portfolio by asset CODE — ETH on Ethereum, Arbitrum and Base is one slice, as
 * is USDC everywhere, because "how much of my money is in ETH" does not care which chain
 * holds it. Largest first; past `ALLOCATION_SLICES` the rest is one "other" slice. A row
 * with no price adds nothing — a value it does not have cannot be a share of anything.
 */
export function allocationByAsset(rows: AssetRow[]): Slice[] {
  const byCode = new Map<string, number>();
  for (const r of rows) {
    if (r.value === null || r.value <= 0) continue;
    byCode.set(r.code, (byCode.get(r.code) ?? 0) + r.value);
  }
  const total = [...byCode.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  const sorted = [...byCode.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, ALLOCATION_SLICES);
  const rest = sorted.slice(ALLOCATION_SLICES).reduce((s, [, v]) => s + v, 0);
  const slices: Slice[] = head.map(([code, value]) => ({ key: code, code, value, share: value / total }));
  if (rest > 0) slices.push({ key: '…', code: '…', value: rest, share: rest / total });
  return slices;
}

export interface NetworkShare {
  network: 'stellar' | OtherChain;
  /** The code whose logo stands for the network. */
  logo: string;
  value: number;
  share: number;
}

/** The priced portfolio by the network that holds it, largest first. */
export function allocationByNetwork(rows: AssetRow[]): NetworkShare[] {
  const byNet = new Map<'stellar' | OtherChain, number>();
  for (const r of rows) {
    if (r.value === null || r.value <= 0) continue;
    const net = r.chain ?? 'stellar';
    byNet.set(net, (byNet.get(net) ?? 0) + r.value);
  }
  const total = [...byNet.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return [...byNet.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([network, value]) => ({
      network,
      logo: network === 'stellar' ? 'XLM' : NATIVE_SYMBOL[network],
      value,
      share: value / total,
    }));
}

export interface Mover {
  code: string;
  change: number;
}

/**
 * The assets held, by today's move, biggest absolute move first — a fall is as much news
 * as a rise. Only codes with a live 24h change, once each.
 */
export function movers(rows: AssetRow[], prices: Record<string, PriceInfo>, limit = 6): Mover[] {
  const seen = new Set<string>();
  const out: Mover[] = [];
  for (const r of rows) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    const change = prices[r.code]?.change24h;
    if (typeof change === 'number' && Number.isFinite(change)) out.push({ code: r.code, change });
  }
  return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, limit);
}
