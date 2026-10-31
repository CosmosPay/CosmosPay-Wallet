/**
 * Sending on Hyperliquid's HyperCore (`lib/send/hypercore.ts`). Every value here was asked of the
 * API itself on 2026-10-29 (`spotMeta`, `allMids`, `userRole`, `preTransferCheck`; keyless,
 * `access-control-allow-origin: *` on `/info` and `/exchange`).
 */
import type { ChainNet } from '@/constants/chains';

/**
 * The one host per mode the wallet signs for. HyperCore has no node to choose: the API is the
 * exchange, so a balance source pointing anywhere else is refused rather than sent a signature.
 * The balance reader's `…/info` and the sender's `…/exchange` are both on it.
 */
export const HYPERCORE_API: Record<ChainNet, string> = {
  mainnet: 'https://api.hyperliquid.xyz',
  testnet: 'https://api.hyperliquid-testnet.xyz',
};

/** `hyperliquidChain`, a signed field: what binds a signature to the main or the test network. */
export const HYPERCORE_CHAIN: Record<ChainNet, 'Mainnet' | 'Testnet'> = {
  mainnet: 'Mainnet',
  testnet: 'Testnet',
};

/**
 * The EIP-712 domain's chain id, in hex as the action carries it. Hyperliquid accepts any (it is
 * the chain the signing wallet was on); 0x66eee (421614) is what the official SDK signs with,
 * and what its published vectors use.
 */
export const HYPERCORE_SIGNATURE_CHAIN_ID = '0x66eee';

export interface HypercoreSpotToken {
  /** `spotMeta.tokens[].name`, and the `coin` `spotClearinghouseState` lists it under. */
  name: string;
  /** `spotMeta.tokens[].tokenId`: a `spotSend` names its token as `name:tokenId`. */
  tokenId: string;
  /** `spotMeta.tokens[].weiDecimals`: the precision a transfer amount is written to. */
  weiDecimals: number;
}

/**
 * What the wallet pays on HyperCore, by the asset the screen uses: `native` is HYPE, `USDC` the
 * registry token. Spot balances — the ones `lib/networkBalances.ts` reads — so a send is a
 * `spotSend`; `usdSend` would move the perps margin, which the wallet never shows.
 * The test network has its own token ids (its HYPE is index 1105, not 150).
 */
export const HYPERCORE_SPOT_TOKENS: Record<ChainNet, Record<string, HypercoreSpotToken>> = {
  mainnet: {
    native: { name: 'HYPE', tokenId: '0x0d01dc56dcaaca66ad901c959b4011ec', weiDecimals: 8 },
    USDC: { name: 'USDC', tokenId: '0x6d1e7cde53ba9467b783cb7c530ce054', weiDecimals: 8 },
  },
  testnet: {
    native: { name: 'HYPE', tokenId: '0x7317beb7cceed72ef0b346074cc8e7ab', weiDecimals: 8 },
    USDC: { name: 'USDC', tokenId: '0xeb62eee3685fc4c43992febcd9e75443', weiDecimals: 8 },
  },
};

/** The token the activation fee is charged in: the quote token, USDC (8 decimals on HyperCore). */
export const HYPERCORE_FEE_TOKEN = 'USDC';

/**
 * HyperCore's one transfer cost: a destination that has never held anything is activated by its
 * first incoming transfer for 1 quote token, paid by the sender on top of the amount
 * (Hyperliquid docs, "Activation gas fee"; `preTransferCheck` answers `fee: "1.0"` for such an
 * address). Any other `spotSend` is free. A higher answer would mean the rule changed: refused.
 */
export const HYPERCORE_ACTIVATION_FEE_MAX = 100_000_000n; // 1 USDC

/**
 * The HYPE/USDC spot pair (`spotMeta.universe[].name`) whose `allMids` price values that USDC fee
 * in HYPE, the unit `maxFee` is in.
 */
export const HYPERCORE_HYPE_USDC_PAIR: Record<ChainNet, string> = {
  mainnet: '@107',
  testnet: '@1035',
};

/**
 * HyperCore answers an accepted transfer with no id. The explorer's hash is read back from the
 * account's ledger (`userNonFundingLedgerUpdates`, the entry carrying our nonce): this many
 * tries, this far apart — a block is well under a second.
 */
export const HYPERCORE_RECEIPT_TRIES = 5;
export const HYPERCORE_RECEIPT_INTERVAL_MS = 800;
