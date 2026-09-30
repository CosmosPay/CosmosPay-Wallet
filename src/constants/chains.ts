/**
 * Solana and Monad, as the swap screen pays from them.
 *
 * The same recovery phrase that holds the Stellar account derives one address on each
 * (`lib/chainAddresses.ts`); these are the tokens the wallet offers there and the knobs it
 * signs with. Mainnet only — Jupiter, Kuru Flow and NEAR Intents have no testnet.
 */

/** A chain the wallet can pay from besides Stellar. */
export type OtherChain = 'solana' | 'monad';
export const OTHER_CHAINS: readonly OtherChain[] = ['solana', 'monad'];

/** A token the wallet offers on a chain. `asset` is what the gateway takes and answers. */
export interface ChainToken {
  symbol: string;
  /** `native` (SOL / MON), or the SPL mint / ERC-20 address. */
  asset: string;
  decimals: number;
}

/**
 * The native coin and the dollar stablecoins. The gateway can swap any mint or ERC-20,
 * but a wallet that lists tokens it cannot price or show an icon for invites the user to
 * buy something they then cannot find; this list is what the screen can stand behind.
 * The addresses are the issuers' canonical ones (Circle USDC, Tether USDT / USDT0).
 */
export const CHAIN_TOKENS: Record<OtherChain, readonly ChainToken[]> = {
  solana: [
    { symbol: 'SOL', asset: 'native', decimals: 9 },
    { symbol: 'USDC', asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    { symbol: 'USDT', asset: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  ],
  monad: [
    { symbol: 'MON', asset: 'native', decimals: 18 },
    { symbol: 'USDC', asset: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', decimals: 6 },
    { symbol: 'USDT0', asset: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6 },
  ],
};

/** Monad mainnet's chain id (EIP-155). A transaction signed for it is worthless elsewhere. */
export const MONAD_CHAIN_ID = 143;

/**
 * What selling the native coin leaves behind, in its base units: the fees of the
 * transaction itself and, on Solana, the rent of the token accounts a swap may open
 * (~0.002 SOL each). Without it "swap all my SOL" builds a transaction that cannot pay
 * for itself and fails in simulation with an error nobody can read.
 */
export const NATIVE_RESERVE: Record<OtherChain, bigint> = {
  solana: 10_000_000n, // 0.01 SOL
  monad: 50_000_000_000_000_000n, // 0.05 MON
};

/**
 * Slippage for a Jupiter / Kuru swap (0.5%), the same as a Stellar path payment's. The
 * gateway caps it with its own setting either way.
 */
export const CHAIN_SWAP_SLIPPAGE_BPS = 50;

/** One JSON-RPC call to a Solana / Monad node, end to end. */
export const CHAIN_RPC_TIMEOUT_MS = 15_000;

/**
 * How long the wallet waits for its ERC-20 approval to land before sending the swap
 * that spends it. Monad blocks are sub-second; a minute is a congested node, and past
 * it the user is told rather than left watching a spinner.
 */
export const CHAIN_CONFIRM_TIMEOUT_MS = 60_000;
export const CHAIN_CONFIRM_POLL_MS = 1_500;

/**
 * Gas limit headroom over `eth_estimateGas` (120%). An estimate is run against the
 * current state; a router whose route moves a pool between estimate and inclusion can
 * need a little more, and running out of gas still charges it.
 */
export const EVM_GAS_HEADROOM_PCT = 120n;

/** `maxFeePerGas` = base fee × this + tip: survives two full blocks of base-fee growth. */
export const EVM_BASE_FEE_MULTIPLIER = 2n;

/** Where the success screen links a transaction on each chain. */
export const CHAIN_EXPLORER_TX: Record<OtherChain, (id: string) => string> = {
  solana: (id) => `https://solscan.io/tx/${id}`,
  monad: (id) => `https://monadscan.com/tx/${id}`,
};
