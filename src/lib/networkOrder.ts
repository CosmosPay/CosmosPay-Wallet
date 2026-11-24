/**
 * The order networks are listed in when what a person holds does not decide it.
 *
 * The registry's own order (`NETWORK_IDS`) starts with Stellar, Solana and Monad because those
 * were the wallet's first three networks, not because they come first for anyone: a list that
 * followed it led with the same three every time, whatever was held. The wallet is every network
 * it holds an address on, so a list with nothing else to go by is alphabetical by the network's
 * name (`NETWORKS[id].name`, the main network's, so the order does not move with the mode).
 *
 * What is held still goes first, by value: `byHolding` is the rule Home's network filter and
 * Send's asset picker share, and `tests/unit/networkOrder.test.ts` pins both.
 */
import { NETWORKS, NETWORK_IDS, type NetworkId } from '@/constants/networks';

/** Every network, A to Z by name. */
export const NETWORKS_BY_NAME: readonly NetworkId[] = [...NETWORK_IDS].sort((a, b) =>
  NETWORKS[a].name.localeCompare(NETWORKS[b].name, 'en', { sensitivity: 'base' }),
);

const RANK = new Map<NetworkId, number>(NETWORKS_BY_NAME.map((id, i) => [id, i]));

/** A network's place in the neutral order. */
export function networkRank(id: NetworkId): number {
  return RANK.get(id) ?? NETWORKS_BY_NAME.length;
}

/** What `byHolding` needs of a row: its network, whether something is held, and its value. */
export interface HoldingOrderItem {
  network: NetworkId;
  held: boolean;
  /** In dollars; null when it has no price (it then follows the priced ones). */
  value: number | null;
}

/**
 * Held first, the highest value first (a held row without a price after the priced ones), then
 * everything else by `networkRank`. Ties keep the order they came in, so a network's own coin
 * stays ahead of its tokens.
 */
export function byHolding<T extends HoldingOrderItem>(items: readonly T[]): T[] {
  const worth = (x: T) => x.value ?? -1;
  return [...items].sort((a, b) => {
    if (a.held !== b.held) return a.held ? -1 : 1;
    if (a.held && worth(a) !== worth(b)) return worth(b) - worth(a);
    return networkRank(a.network) - networkRank(b.network);
  });
}
