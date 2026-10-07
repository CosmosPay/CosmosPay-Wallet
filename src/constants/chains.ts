/**
 * Solana and Monad, as the swap screen pays from them.
 *
 * The same recovery phrase that holds the Stellar account derives one address on each
 * (`lib/chainAddresses.ts`); these are the tokens the wallet offers there and the knobs it
 * signs with. Swaps are mainnet only — Jupiter, Kuru Flow and NEAR Intents have no
 * testnet; the test networks hold a native balance and nothing else (see below).
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

/* ----------------------------- test networks ----------------------------- */
// None of the swap above runs here. What a test network gives a developer is a balance
// and a way to move it: the same phrase's addresses on Solana devnet and Monad testnet,
// funded for free, shown whenever the Stellar network is a test one (`networkEnv` → 'dev').

/** Which of a chain's networks a call goes to. Swaps only ever use 'mainnet'. */
export type ChainNet = 'mainnet' | 'testnet';

/**
 * The test tokens: the native coin and Circle's test USDC, whose addresses are the ones
 * Circle publishes (developers.circle.com, "USDC contract addresses") and were read back
 * from each chain as a 6-decimal USDC. faucet.circle.com hands out both.
 */
export const CHAIN_TESTNET_TOKENS: Record<OtherChain, readonly ChainToken[]> = {
  solana: [
    { symbol: 'SOL', asset: 'native', decimals: 9 },
    { symbol: 'USDC', asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 },
  ],
  monad: [
    { symbol: 'MON', asset: 'native', decimals: 18 },
    { symbol: 'USDC', asset: '0x534b2f3A21130d7a60830c2Df862319e593943A3', decimals: 6 },
  ],
};

/** The token list each network offers. */
export const CHAIN_TOKENS_BY_NET: Record<ChainNet, Record<OtherChain, readonly ChainToken[]>> = {
  mainnet: CHAIN_TOKENS,
  testnet: CHAIN_TESTNET_TOKENS,
};

/** Monad testnet's chain id (EIP-155). */
export const MONAD_TESTNET_CHAIN_ID = 10143;

/** The chain id a Monad transaction is signed for, and the one its node must report. */
export const MONAD_CHAIN_IDS: Record<ChainNet, number> = {
  mainnet: MONAD_CHAIN_ID,
  testnet: MONAD_TESTNET_CHAIN_ID,
};

/** What one devnet airdrop asks for (1 SOL). Devnet refuses larger requests outright. */
export const SOLANA_AIRDROP_LAMPORTS = 1_000_000_000n;

/**
 * The least a Solana account with no data may hold (rent exemption). A SOL transfer that
 * would OPEN an account with less is refused by the runtime with an error about rent;
 * the wallet refuses it first and says so.
 */
export const SOLANA_RENT_EXEMPT_LAMPORTS = 890_880n;

/**
 * The web faucets. Monad testnet has no faucet a client can call — it sits behind a
 * captcha — and devnet's `requestAirdrop` is rate-limited per IP, so both chains offer the
 * page as well as (on Solana) the one-tap airdrop. Circle's covers the test USDC of both.
 */
export const CHAIN_TESTNET_FAUCET: Record<OtherChain, string> = {
  solana: 'https://faucet.solana.com',
  monad: 'https://faucet.monad.xyz',
};
export const USDC_TESTNET_FAUCET = 'https://faucet.circle.com';

/** Where the test-network card links an address on each chain. */
export const CHAIN_TESTNET_EXPLORER_ADDRESS: Record<OtherChain, (address: string) => string> = {
  solana: (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
  monad: (a) => `https://testnet.monadexplorer.com/address/${a}`,
};

/** Where the success screen links a test-network transaction. */
export const CHAIN_TESTNET_EXPLORER_TX: Record<OtherChain, (id: string) => string> = {
  solana: (id) => `https://explorer.solana.com/tx/${id}?cluster=devnet`,
  monad: (id) => `https://testnet.monadexplorer.com/tx/${id}`,
};

/** Where the success screen links a transaction on each chain. */
export const CHAIN_EXPLORER_TX: Record<OtherChain, (id: string) => string> = {
  solana: (id) => `https://solscan.io/tx/${id}`,
  monad: (id) => `https://monadscan.com/tx/${id}`,
};

/** Where the Home card links an address on each chain's mainnet. */
export const CHAIN_EXPLORER_ADDRESS: Record<OtherChain, (address: string) => string> = {
  solana: (a) => `https://solscan.io/account/${a}`,
  monad: (a) => `https://monadscan.com/address/${a}`,
};

/** The address explorers of each network. */
export const CHAIN_EXPLORER_ADDRESS_BY_NET: Record<ChainNet, Record<OtherChain, (address: string) => string>> = {
  mainnet: CHAIN_EXPLORER_ADDRESS,
  testnet: CHAIN_TESTNET_EXPLORER_ADDRESS,
};
