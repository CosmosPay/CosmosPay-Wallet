/**
 * The chains the wallet holds besides Stellar: Bitcoin, Ethereum, Solana, Arbitrum, Base and
 * Monad.
 *
 * The same recovery phrase that holds the Stellar account derives one address on each
 * (`lib/chainAddresses.ts`) — one Bitcoin address, one Solana address, and ONE EVM address
 * shared by the four EVM chains, exactly as MetaMask shows the same 0x… on every network.
 * These are the tokens the wallet offers there and the knobs it signs with.
 *
 * Swaps are mainnet only — Jupiter, Kuru Flow and NEAR Intents have no testnet; the test
 * networks hold a balance and a way to move it, nothing else (see below).
 */

/** The EVM chains. One address, one key, a different chain id in every signature. */
export type EvmChain = 'ethereum' | 'arbitrum' | 'base' | 'monad';
export const EVM_CHAINS: readonly EvmChain[] = ['ethereum', 'arbitrum', 'base', 'monad'];

/** A chain the wallet can hold and pay from besides Stellar. */
export type OtherChain = 'bitcoin' | 'solana' | EvmChain;

/** In the order Home lists them: the two reserve assets first, then by how widely they are held. */
export const OTHER_CHAINS: readonly OtherChain[] = ['bitcoin', 'ethereum', 'solana', 'arbitrum', 'base', 'monad'];

export const isEvmChain = (chain: string): chain is EvmChain => (EVM_CHAINS as readonly string[]).includes(chain);

/** A token the wallet offers on a chain. `asset` is what the gateway takes and answers. */
export interface ChainToken {
  symbol: string;
  /** `native` (BTC / ETH / SOL / MON), or the SPL mint / ERC-20 address. */
  asset: string;
  decimals: number;
}

/**
 * The native coin and the dollar stablecoins. The gateway can swap any mint or ERC-20,
 * but a wallet that lists tokens it cannot price or show an icon for invites the user to
 * buy something they then cannot find; this list is what the screen can stand behind.
 * The addresses are the issuers' canonical ones (Circle USDC, Tether USDT / USDT0), EIP-55
 * spelled, and each was read back from its chain as the token it claims to be.
 */
export const CHAIN_TOKENS: Record<OtherChain, readonly ChainToken[]> = {
  bitcoin: [{ symbol: 'BTC', asset: 'native', decimals: 8 }],
  ethereum: [
    { symbol: 'ETH', asset: 'native', decimals: 18 },
    { symbol: 'USDC', asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT', asset: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  ],
  solana: [
    { symbol: 'SOL', asset: 'native', decimals: 9 },
    { symbol: 'USDC', asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    { symbol: 'USDT', asset: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  ],
  arbitrum: [
    { symbol: 'ETH', asset: 'native', decimals: 18 },
    { symbol: 'USDC', asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'USDT0', asset: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
  ],
  base: [
    { symbol: 'ETH', asset: 'native', decimals: 18 },
    { symbol: 'USDC', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  ],
  monad: [
    { symbol: 'MON', asset: 'native', decimals: 18 },
    { symbol: 'USDC', asset: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', decimals: 6 },
    { symbol: 'USDT0', asset: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6 },
  ],
};

/** Each chain's native coin — the one its fees are paid in. */
export const NATIVE_SYMBOL: Record<OtherChain, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  solana: 'SOL',
  arbitrum: 'ETH',
  base: 'ETH',
  monad: 'MON',
};

/**
 * What selling the native coin leaves behind, in its base units: the fees of the
 * transaction itself and, on Solana, the rent of the token accounts a swap may open
 * (~0.002 SOL each). Without it "swap all my SOL" builds a transaction that cannot pay
 * for itself and fails in simulation with an error nobody can read.
 *
 * On Base and Arbitrum the margin also covers the L1 data fee, which is charged on top of
 * gas and is not part of `eth_estimateGas`. Bitcoin computes its fee exactly when it
 * builds (`lib/bitcoinTx.ts`); this is only what the screen holds back as "available".
 */
export const NATIVE_RESERVE: Record<OtherChain, bigint> = {
  bitcoin: 5_000n, // 0.00005 BTC — ~140 vB at 35 sat/vB
  ethereum: 1_000_000_000_000_000n, // 0.001 ETH
  solana: 10_000_000n, // 0.01 SOL
  arbitrum: 100_000_000_000_000n, // 0.0001 ETH
  base: 100_000_000_000_000n, // 0.0001 ETH
  monad: 50_000_000_000_000_000n, // 0.05 MON
};

/**
 * Where a swap that stays on one chain is settled. Solana and Monad have a venue the
 * gateway builds for (Jupiter, Kuru Flow); the rest have none, so even a swap that never
 * leaves Ethereum, Arbitrum or Base goes through NEAR Intents, like a bridge does. Bitcoin
 * holds one asset and has no same-chain swap at all.
 */
export type SwapVenue = 'jupiter' | 'kuru' | 'intents';
export const SAME_CHAIN_VENUE: Record<OtherChain, SwapVenue | null> = {
  bitcoin: null,
  ethereum: 'intents',
  solana: 'jupiter',
  arbitrum: 'intents',
  base: 'intents',
  monad: 'kuru',
};

/**
 * Slippage for a Jupiter / Kuru swap (0.5%), the same as a Stellar path payment's. The
 * gateway caps it with its own setting either way.
 */
export const CHAIN_SWAP_SLIPPAGE_BPS = 50;

/** One JSON-RPC / Esplora call to a chain's node, end to end. */
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

/**
 * The most one EVM transaction may commit to in fees, per chain: `maxFeePerGas × gasLimit`.
 * Both factors come from a node — a public one, or whatever the person set in developer
 * mode — and nothing else bounds them, so past this the wallet refuses (`fee`) instead of
 * signing what the node said. Set well above a congested day for a swap: 0.02 ETH on
 * Ethereum, 0.002 ETH on the rollups, 20 MON. Bitcoin has its own bound (`BITCOIN_MAX_FEE_RATE`).
 */
export const EVM_MAX_FEE_WEI: Record<EvmChain, bigint> = {
  ethereum: 20_000_000_000_000_000n,
  arbitrum: 2_000_000_000_000_000n,
  base: 2_000_000_000_000_000n,
  monad: 20_000_000_000_000_000_000n,
};

/* ------------------------------- Bitcoin -------------------------------- */

/**
 * The dust limit of a P2WPKH output (294 sats). A change output below it would be
 * refused by every node's relay policy, so the builder folds it into the fee instead.
 */
export const BITCOIN_DUST_SATS = 294n;

/** The fee rate the builder never goes below (sat/vB) — the relay floor. */
export const BITCOIN_MIN_FEE_RATE = 1;

/**
 * The highest fee rate the builder accepts from the fee estimator (sat/vB). A node that
 * answered more is either broken or describing a fee market nobody should pay into
 * without being asked; the send is refused rather than quietly spending a fortune.
 */
export const BITCOIN_MAX_FEE_RATE = 500;

/** How many unspent outputs the builder will spend at most — a bound on the size it signs. */
export const BITCOIN_MAX_INPUTS = 60;

/* ----------------------------- test networks ----------------------------- */
// None of the swaps above runs here. What a test network gives a developer is a balance
// and a way to move it: the same phrase's addresses on Bitcoin testnet4, Sepolia, Solana
// devnet, Arbitrum Sepolia, Base Sepolia and Monad testnet, funded for free, shown whenever
// the Stellar network is a test one (`networkEnv` → 'dev').

/** Which of a chain's networks a call goes to. Swaps only ever use 'mainnet'. */
export type ChainNet = 'mainnet' | 'testnet';

/**
 * The test tokens: the native coin and Circle's test USDC, whose addresses are the ones
 * Circle publishes (developers.circle.com, "USDC contract addresses") and were read back
 * from each chain as a 6-decimal USDC. faucet.circle.com hands out all of them.
 */
export const CHAIN_TESTNET_TOKENS: Record<OtherChain, readonly ChainToken[]> = {
  bitcoin: [{ symbol: 'BTC', asset: 'native', decimals: 8 }],
  ethereum: [
    { symbol: 'ETH', asset: 'native', decimals: 18 },
    { symbol: 'USDC', asset: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
  ],
  solana: [
    { symbol: 'SOL', asset: 'native', decimals: 9 },
    { symbol: 'USDC', asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 },
  ],
  arbitrum: [
    { symbol: 'ETH', asset: 'native', decimals: 18 },
    { symbol: 'USDC', asset: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', decimals: 6 },
  ],
  base: [
    { symbol: 'ETH', asset: 'native', decimals: 18 },
    { symbol: 'USDC', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 },
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

/**
 * The EIP-155 chain id each EVM transaction is signed for, and the one its node must
 * report before the wallet reads a balance from it or signs anything for it. Not
 * configurable: a node override pointed at the wrong chain must be refused, not believed.
 */
export const EVM_CHAIN_IDS: Record<ChainNet, Record<EvmChain, number>> = {
  mainnet: { ethereum: 1, arbitrum: 42161, base: 8453, monad: 143 },
  testnet: { ethereum: 11155111, arbitrum: 421614, base: 84532, monad: 10143 },
};

/** Monad mainnet's chain id (EIP-155). A transaction signed for it is worthless elsewhere. */
export const MONAD_CHAIN_ID = EVM_CHAIN_IDS.mainnet.monad;

/** Monad testnet's chain id (EIP-155). */
export const MONAD_TESTNET_CHAIN_ID = EVM_CHAIN_IDS.testnet.monad;

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
 * The most accounts one `getMultipleAccounts` (and a simulation's account read-back) may
 * name. The Jupiter check reads every account a swap may write; a transaction naming more
 * than a node will read back is refused, never checked in part.
 */
export const SOLANA_MAX_READ_ACCOUNTS = 100;

/**
 * The web faucets. None of these chains has a faucet a client can call without a captcha
 * except Solana devnet, whose `requestAirdrop` is rate-limited per IP — so every chain
 * offers the page and Solana also the one-tap airdrop. Circle's covers the test USDC.
 */
export const CHAIN_TESTNET_FAUCET: Record<OtherChain, string> = {
  bitcoin: 'https://mempool.space/testnet4/faucet',
  ethereum: 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia',
  solana: 'https://faucet.solana.com',
  arbitrum: 'https://faucet.quicknode.com/arbitrum/sepolia',
  base: 'https://portal.cdp.coinbase.com/products/faucet',
  monad: 'https://faucet.monad.xyz',
};
export const USDC_TESTNET_FAUCET = 'https://faucet.circle.com';

/** Where the test-network card links an address on each chain. */
export const CHAIN_TESTNET_EXPLORER_ADDRESS: Record<OtherChain, (address: string) => string> = {
  bitcoin: (a) => `https://mempool.space/testnet4/address/${a}`,
  ethereum: (a) => `https://sepolia.etherscan.io/address/${a}`,
  solana: (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
  arbitrum: (a) => `https://sepolia.arbiscan.io/address/${a}`,
  base: (a) => `https://sepolia.basescan.org/address/${a}`,
  monad: (a) => `https://testnet.monadexplorer.com/address/${a}`,
};

/** Where the success screen links a test-network transaction. */
export const CHAIN_TESTNET_EXPLORER_TX: Record<OtherChain, (id: string) => string> = {
  bitcoin: (id) => `https://mempool.space/testnet4/tx/${id}`,
  ethereum: (id) => `https://sepolia.etherscan.io/tx/${id}`,
  solana: (id) => `https://explorer.solana.com/tx/${id}?cluster=devnet`,
  arbitrum: (id) => `https://sepolia.arbiscan.io/tx/${id}`,
  base: (id) => `https://sepolia.basescan.org/tx/${id}`,
  monad: (id) => `https://testnet.monadexplorer.com/tx/${id}`,
};

/** Where the success screen links a transaction on each chain. */
export const CHAIN_EXPLORER_TX: Record<OtherChain, (id: string) => string> = {
  bitcoin: (id) => `https://mempool.space/tx/${id}`,
  ethereum: (id) => `https://etherscan.io/tx/${id}`,
  solana: (id) => `https://solscan.io/tx/${id}`,
  arbitrum: (id) => `https://arbiscan.io/tx/${id}`,
  base: (id) => `https://basescan.org/tx/${id}`,
  monad: (id) => `https://monadscan.com/tx/${id}`,
};

/** Where the Home card links an address on each chain's mainnet. */
export const CHAIN_EXPLORER_ADDRESS: Record<OtherChain, (address: string) => string> = {
  bitcoin: (a) => `https://mempool.space/address/${a}`,
  ethereum: (a) => `https://etherscan.io/address/${a}`,
  solana: (a) => `https://solscan.io/account/${a}`,
  arbitrum: (a) => `https://arbiscan.io/address/${a}`,
  base: (a) => `https://basescan.org/address/${a}`,
  monad: (a) => `https://monadscan.com/address/${a}`,
};

/** The address explorers of each network. */
export const CHAIN_EXPLORER_ADDRESS_BY_NET: Record<ChainNet, Record<OtherChain, (address: string) => string>> = {
  mainnet: CHAIN_EXPLORER_ADDRESS,
  testnet: CHAIN_TESTNET_EXPLORER_ADDRESS,
};

/** The transaction explorers of each network. */
export const CHAIN_EXPLORER_TX_BY_NET: Record<ChainNet, Record<OtherChain, (id: string) => string>> = {
  mainnet: CHAIN_EXPLORER_TX,
  testnet: CHAIN_TESTNET_EXPLORER_TX,
};
