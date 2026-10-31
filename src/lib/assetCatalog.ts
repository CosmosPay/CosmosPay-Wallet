/**
 * What "add an asset" offers on every network but Stellar (whose assets are trustlines, offered
 * from the Stellar registry by features/extras/AddAsset.tsx): each network's coin and registry
 * tokens, which the wallet always reads, and every other token NEAR Intents lists on a network
 * whose balance source can read one (lib/trackedTokens.ts) — what the person can add. Pure, so
 * it is unit-tested (tests/unit/assetCatalog.test.ts).
 */
import { NETWORKS, NETWORK_IDS, type NetworkId } from '@/constants/networks';
import type { CrossChainAsset } from '@/lib/cosmospay';
import { canTrack, isRegistryToken, toTrackedToken } from '@/lib/trackedTokens';
import { hasTestNetwork } from '@/lib/testnets';
import type { ChainNet } from '@/constants/chains';

export interface CatalogEntry {
  network: NetworkId;
  symbol: string;
  /** `native`, or the token's contract as its network spells it. */
  asset: string;
  decimals: number;
  /** native and registry are always read; addable is the person's choice. */
  kind: 'native' | 'registry' | 'addable';
}

export function buildCatalog(intents: readonly CrossChainAsset[] | null, env: ChainNet = 'mainnet'): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const id of NETWORK_IDS) {
    if (id === 'stellar') continue;
    const def = NETWORKS[id];
    // A test mode: the coin of each network with a test network here, nothing else — the
    // registry's and NEAR Intents' tokens are main-network contracts.
    if (env === 'testnet') {
      if (hasTestNetwork(id)) out.push({ network: id, symbol: def.coin, asset: 'native', decimals: def.decimals, kind: 'native' });
      continue;
    }
    out.push({ network: id, symbol: def.coin, asset: 'native', decimals: def.decimals, kind: 'native' });
    for (const t of def.tokens) out.push({ network: id, symbol: t.symbol, asset: t.asset, decimals: t.decimals, kind: 'registry' });
    if (!canTrack(id)) continue;
    const seen = new Set<string>();
    for (const a of intents ?? []) {
      if (a.chain !== id || a.contract === null) continue;
      const token = toTrackedToken(id, { symbol: a.symbol, asset: a.contract, decimals: a.decimals });
      if (!token || isRegistryToken(id, token.asset) || seen.has(token.asset)) continue;
      seen.add(token.asset);
      out.push({ network: id, symbol: token.symbol, asset: token.asset, decimals: token.decimals, kind: 'addable' });
    }
  }
  return out;
}

/** "0x1234…cdef": a contract short enough for a row, both ends kept. */
export function shortAsset(asset: string): string {
  const id = asset.includes('::') ? asset.split('::')[0] : asset;
  return id.length <= 14 ? asset : `${id.slice(0, 6)}…${id.slice(-4)}`;
}
