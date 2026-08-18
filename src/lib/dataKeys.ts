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

/** Prefixes, for invalidating a whole domain after a write. */
export const ACCOUNT_PREFIX = 'account|';
export const HISTORY_PREFIX = 'history|';

/**
 * How long each read stays fresh. Balances are short: a payment must show up
 * promptly. Prices are long: CoinGecko rate-limits, and every shell (popup, side
 * panel, web tab) polls independently.
 */
export const TTL = {
  account: 15_000,
  history: 30_000,
  prices: 60_000,
} as const;
