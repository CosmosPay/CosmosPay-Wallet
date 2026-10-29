/**
 * The cross-chain pieces that are about networks rather than money: which of NEAR Intents' assets
 * a wallet offers to receive on a network, and whether two spellings name one address.
 */
import { NETWORKS, NETWORK_IDS, type NetworkId } from '@/constants/networks';
import type { CrossChainAsset } from '@/lib/cosmospay';

const STABLES = new Set(['USDC', 'USDT', 'USDT0']);

/** A network this wallet knows; NEAR Intents may list chains it does not hold an address on. */
export const isKnownNetwork = (chain: string): chain is NetworkId => (NETWORK_IDS as readonly string[]).includes(chain);

/**
 * What the wallet offers to receive on `chain`: the coin and the dollar stablecoins, coin first.
 * NEAR Intents lists dozens of tokens on some networks; a wallet receiving into its own address
 * wants what it can show and price. A network NEAR Intents lists none of those on offers all it lists.
 */
export function crossChainDestinations(assets: readonly CrossChainAsset[], chain: NetworkId): CrossChainAsset[] {
  const here = assets.filter((a) => a.chain === chain);
  const picked = here.filter((a) => a.contract === null || STABLES.has(a.symbol));
  return (picked.length ? picked : here).sort((a, b) => (a.contract === null ? -1 : 0) - (b.contract === null ? -1 : 0));
}

/**
 * Whether two spellings are one address on `network`, the way the server normalizes them: hex
 * (EVM) and bech32 (Bitcoin, Litecoin) in any single case, a cashaddr with or without its
 * `bitcoincash:` prefix. Everything else is compared exactly — base58 is case-sensitive.
 */
export function sameNetworkAddress(network: NetworkId, a: string, b: string): boolean {
  const kind = NETWORKS[network].address;
  const fold = (v: string) => {
    const s = v.trim();
    if (kind === 'evm') return s.toLowerCase();
    if ((kind === 'btc' || kind === 'ltc') && /^(bc1|ltc1)/i.test(s)) return s.toLowerCase();
    if (kind === 'bch') return s.toLowerCase().replace(/^bitcoincash:/, '');
    return s;
  };
  return fold(a) === fold(b);
}
