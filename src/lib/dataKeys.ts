/**
 * The cache key space.
 *
 * Every read this wallet performs is scoped to `network × account` — balances,
 * history, pool positions, KYC receivers, and even which CosmosPay API key applies.
 * Nothing in the code ever said so, which is why switching network could leave the
 * previous network's balance on screen: there was no name for "this value belongs to
 * that pair", so there was nothing to invalidate.
 *
 * Keys are `domain|network|account|…`, so a prefix identifies a whole scope:
 *   invalidate('account|')            -> every account read, any network
 *   invalidate(scopeKey(net, pub))    -> everything for one wallet on one network
 */

/** Everything belonging to one (network, account) pair. */
export const scopeKey = (networkId: string, publicKey: string) => `|${networkId}|${publicKey}`;

export const accountKey = (networkId: string, publicKey: string) => `account${scopeKey(networkId, publicKey)}`;
export const historyKey = (networkId: string, publicKey: string) => `history${scopeKey(networkId, publicKey)}`;

/** Prices are global — the same USD quote regardless of which wallet is open. */
export const PRICES_KEY = 'prices';

/**
 * Gateway operation history — swaps, fiat payins/payouts, liquidity operations.
 *
 * Scoped like everything else, and by the account rather than only the network: the
 * rows come back scoped to the API key's organization, and a second wallet on this
 * device has its own key and its own organization. Keying on the network alone would
 * show one wallet's payouts under another's.
 */
export const opsKey = (networkId: string, publicKey: string, domain: OpsDomain) =>
  `ops:${domain}${scopeKey(networkId, publicKey)}`;

export type OpsDomain = 'swaps' | 'payins' | 'payouts' | 'liquidity';

/** Prefixes, for invalidating a whole domain after a write. */
export const ACCOUNT_PREFIX = 'account|';
export const HISTORY_PREFIX = 'history|';
export const OPS_PREFIX = 'ops:';

/**
 * How long each read stays fresh. Balances are short: a payment must show up
 * promptly. Prices are long: CoinGecko rate-limits, and every shell (popup, side
 * panel, web tab) polls independently.
 */
export const TTL = {
  account: 15_000,
  history: 30_000,
  prices: 60_000,
  /**
   * Gateway operations. Longer than a balance because these rows change on the
   * gateway's clock, not the ledger's: a payin waits on a bank transfer and a payout on
   * a compliance review, both measured in hours. Short enough that a swap confirming in
   * the next block is not stale for long.
   */
  ops: 20_000,
} as const;
