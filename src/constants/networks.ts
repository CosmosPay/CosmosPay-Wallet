/**
 * Every network the wallet holds an address on: the ones NEAR Intents settles, the same list the
 * community server's cross-chain swaps accept (`CROSS_CHAIN_NETWORK_IDS` there — the ids are the
 * server's, so a swap names a network the way both sides spell it).
 *
 * The wallet is not a Stellar wallet with extras (the user's call): one recovery phrase is an
 * address on each of these, derived on the device (`lib/chainAddresses.ts`), and a wallet
 * imported from a bare Stellar secret gets a phrase of its own for them, derived from that
 * secret (`networksPhraseFromSecret`), so no wallet is ever Stellar-only.
 *
 * Many networks share one address: the sixteen EVM networks are one 0x account, Solana and Fogo
 * one SVM account, Aptos and Movement one Move account. `address` names that family, and
 * `NetworkAddresses` stores one address per family, not per network.
 *
 * Names and tickers are proper nouns, the same in every language — data, like a token symbol.
 * Endpoints are public, keyless and answer CORS; each was probed on 2026-10-28. A network
 * whose `balance` is null shows its address and receives, and reads no balance yet.
 */

export const NETWORK_IDS = [
  'stellar',
  'solana',
  'monad',
  'eth',
  'base',
  'arb',
  'op',
  'bsc',
  'pol',
  'avax',
  'gnosis',
  'bera',
  'scroll',
  'xlayer',
  'abs',
  'plasma',
  'hood',
  'hypercore',
  'btc',
  'ltc',
  'doge',
  'bch',
  'dash',
  'zec',
  'xrp',
  'tron',
  'ton',
  'near',
  'sui',
  'aptos',
  'movement',
  'starknet',
  'cardano',
  'aleo',
  'fogo',
] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];

/** One address format, and the derivation behind it (`lib/chainAddresses.ts`). */
export const ADDRESS_KINDS = [
  'evm',
  'svm',
  'btc',
  'ltc',
  'doge',
  'bch',
  'dash',
  'zec',
  'xrp',
  'tron',
  'ton',
  'near',
  'sui',
  'aptos',
  'starknet',
  'cardano',
  'aleo',
] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];

/**
 * Each family's derivation path (`lib/chainAddresses.ts`): Trust Wallet Core's defaults, so the
 * same phrase shows the same addresses there — Solana excepted, which follows Phantom. Cardano's
 * two paths and Starknet's (from the EVM key) live with their derivations in `lib/addresses/`.
 * Never change one: every address a wallet ever showed on that family would stop being its own.
 */
export const DERIVATION_PATHS = {
  evm: "m/44'/60'/0'/0/0",
  svm: "m/44'/501'/0'/0'",
  btc: "m/84'/0'/0'/0/0",
  ltc: "m/84'/2'/0'/0/0",
  doge: "m/44'/3'/0'/0/0",
  bch: "m/44'/145'/0'/0/0",
  dash: "m/44'/5'/0'/0/0",
  zec: "m/44'/133'/0'/0/0",
  xrp: "m/44'/144'/0'/0/0",
  tron: "m/44'/195'/0'/0/0",
  ton: "m/44'/607'/0'",
  near: "m/44'/397'/0'",
  sui: "m/44'/784'/0'/0'/0'",
  aptos: "m/44'/637'/0'/0'/0'",
} as const satisfies Partial<Record<AddressKind, string>>;

/** A wallet's addresses, one per family. A family the build cannot derive yet is absent. */
export type NetworkAddresses = Partial<Record<AddressKind, string>>;

/**
 * Bumped whenever a family is added to the derivation: an entry derived under an older version
 * is derived again (from the vault, with the session's key — no prompt), so a wallet gains the
 * new networks the next time it is opened.
 */
export const NETWORK_ADDRESSES_VERSION = 2;

/** How a network's balance is read. Each kind is one client in `lib/networkBalances.ts`. */
export type BalanceSource =
  | { kind: 'evm'; rpc: string }
  | { kind: 'svm'; rpc: string }
  | { kind: 'esplora'; api: string }
  | { kind: 'blockcypher'; coin: 'doge' | 'dash' }
  | { kind: 'blockchair'; coin: 'bitcoin-cash' | 'zcash' }
  | { kind: 'xrpl'; rpc: string }
  | { kind: 'trongrid'; api: string }
  | { kind: 'near'; rpc: string }
  | { kind: 'sui'; graphql: string }
  | { kind: 'aptos'; api: string }
  | { kind: 'toncenter'; api: string }
  | { kind: 'hypercore'; api: string };

/** A token the wallet reads a balance of: `native`, or its contract / mint / coin type. */
export interface NetworkToken {
  symbol: string;
  asset: string;
  decimals: number;
}

export interface NetworkDef {
  id: NetworkId;
  name: string;
  /** The native coin's ticker and decimals. */
  coin: string;
  decimals: number;
  /** Which address of the wallet is its account here; `stellar` is the wallet's own key. */
  address: 'stellar' | AddressKind;
  /** EIP-155 id an EVM transaction is signed for; absent where the wallet does not sign. */
  evmChainId?: number;
  balance: BalanceSource | null;
  /**
   * The dollar stablecoins read here besides the coin. Canonical issuer contracts only — the
   * ones NEAR Intents itself trades (its token list, 2026-10-28) — so a balance shown is one the
   * wallet can stand behind and price at $1.
   */
  tokens: readonly NetworkToken[];
  /** Explorer links; `{address}` / `{tx}` are replaced. */
  explorerAddress: string | null;
  explorerTx: string | null;
  /** The wallet builds and signs payments here (Stellar, the EVM networks, the SVM ones). */
  send: boolean;
}

const USDC = (asset: string, decimals = 6): NetworkToken => ({ symbol: 'USDC', asset, decimals });
const USDT = (asset: string, decimals = 6): NetworkToken => ({ symbol: 'USDT', asset, decimals });
const USDT0 = (asset: string): NetworkToken => ({ symbol: 'USDT0', asset, decimals: 6 });

const evm = (
  id: NetworkId,
  name: string,
  coin: string,
  evmChainId: number | undefined,
  rpc: string | null,
  explorer: string | null,
  tokens: NetworkToken[] = [],
): NetworkDef => ({
  id,
  name,
  coin,
  decimals: 18,
  address: 'evm',
  evmChainId,
  balance: rpc ? { kind: 'evm', rpc } : null,
  tokens,
  explorerAddress: explorer ? `${explorer}/address/{address}` : null,
  explorerTx: explorer ? `${explorer}/tx/{tx}` : null,
  send: evmChainId !== undefined && rpc !== null,
});

export const NETWORKS: Record<NetworkId, NetworkDef> = {
  stellar: {
    id: 'stellar',
    name: 'Stellar',
    coin: 'XLM',
    decimals: 7,
    address: 'stellar',
    // Horizon, through the wallet's own Stellar stack — not a client here.
    balance: null,
    tokens: [],
    explorerAddress: 'https://stellar.expert/explorer/public/account/{address}',
    explorerTx: 'https://stellar.expert/explorer/public/tx/{tx}',
    send: true,
  },
  solana: {
    id: 'solana',
    name: 'Solana',
    coin: 'SOL',
    decimals: 9,
    address: 'svm',
    balance: { kind: 'svm', rpc: 'https://api.mainnet-beta.solana.com' },
    tokens: [USDC('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), USDT('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')],
    explorerAddress: 'https://solscan.io/account/{address}',
    explorerTx: 'https://solscan.io/tx/{tx}',
    send: true,
  },
  monad: evm('monad', 'Monad', 'MON', 143, 'https://rpc.monad.xyz', 'https://monadscan.com', [
    USDC('0x754704bc059f8c67012fed69bc8a327a5aafb603'),
    USDT0('0xe7cd86e13ac4309349f30b3435a9d337750fc82d'),
  ]),
  eth: evm('eth', 'Ethereum', 'ETH', 1, 'https://ethereum-rpc.publicnode.com', 'https://etherscan.io', [
    USDC('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'),
    USDT('0xdac17f958d2ee523a2206206994597c13d831ec7'),
  ]),
  base: evm('base', 'Base', 'ETH', 8453, 'https://base-rpc.publicnode.com', 'https://basescan.org', [
    USDC('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'),
  ]),
  arb: evm('arb', 'Arbitrum', 'ETH', 42161, 'https://arbitrum-one-rpc.publicnode.com', 'https://arbiscan.io', [
    USDC('0xaf88d065e77c8cc2239327c5edb3a432268e5831'),
    USDT0('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'),
  ]),
  op: evm('op', 'Optimism', 'ETH', 10, 'https://optimism-rpc.publicnode.com', 'https://optimistic.etherscan.io', [
    USDC('0x0b2c639c533813f4aa9d7837caf62653d097ff85'),
    USDT0('0x01bff41798a0bcf287b996046ca68b395dbc1071'),
  ]),
  bsc: evm('bsc', 'BNB Chain', 'BNB', 56, 'https://bsc-rpc.publicnode.com', 'https://bscscan.com', [
    USDC('0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', 18),
    USDT('0x55d398326f99059ff775485246999027b3197955', 18),
  ]),
  pol: evm('pol', 'Polygon', 'POL', 137, 'https://polygon-bor-rpc.publicnode.com', 'https://polygonscan.com', [
    USDC('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'),
    USDT('0xc2132d05d31c914a87c6611c10748aeb04b58e8f'),
  ]),
  avax: evm('avax', 'Avalanche', 'AVAX', 43114, 'https://avalanche-c-chain-rpc.publicnode.com', 'https://snowtrace.io', [
    USDC('0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e'),
    USDT('0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7'),
  ]),
  gnosis: evm('gnosis', 'Gnosis', 'xDAI', 100, 'https://gnosis-rpc.publicnode.com', 'https://gnosisscan.io', [
    USDC('0x2a22f9c3b484c3629090feed35f17ff8f88f76f0'),
    USDT('0x4ecaba5870353805a9f068101a40e0f32ed605c6'),
  ]),
  bera: evm('bera', 'Berachain', 'BERA', 80094, 'https://berachain-rpc.publicnode.com', 'https://berascan.com', [
    USDT0('0x779ded0c9e1022225f8e0630b35a9b54be713736'),
  ]),
  scroll: evm('scroll', 'Scroll', 'ETH', 534352, 'https://scroll-rpc.publicnode.com', 'https://scrollscan.com', [
    USDT('0xf55bec9cafdbe8730f096aa55dad6d22d44099df'),
  ]),
  xlayer: evm('xlayer', 'X Layer', 'OKB', 196, 'https://rpc.xlayer.tech', 'https://www.okx.com/web3/explorer/xlayer', [
    USDC('0x74b7f16337b8972027f6196a17a631ac6de26d22'),
    USDT0('0x779ded0c9e1022225f8e0630b35a9b54be713736'),
  ]),
  abs: evm('abs', 'Abstract', 'ETH', 2741, 'https://api.mainnet.abs.xyz', 'https://abscan.org'),
  plasma: evm('plasma', 'Plasma', 'XPL', 9745, 'https://rpc.plasma.to', 'https://plasmascan.to', [
    USDT0('0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb'),
  ]),
  // No public chain id the server could verify, so no signing; the 0x account receives.
  hood: evm('hood', 'Robinhood Chain', 'ETH', undefined, null, null),
  hypercore: {
    id: 'hypercore',
    name: 'Hyperliquid',
    coin: 'HYPE',
    decimals: 8,
    address: 'evm',
    balance: { kind: 'hypercore', api: 'https://api.hyperliquid.xyz/info' },
    tokens: [USDC('USDC', 8)],
    explorerAddress: 'https://app.hyperliquid.xyz/explorer/address/{address}',
    explorerTx: 'https://app.hyperliquid.xyz/explorer/tx/{tx}',
    send: false,
  },
  btc: {
    id: 'btc',
    name: 'Bitcoin',
    coin: 'BTC',
    decimals: 8,
    address: 'btc',
    balance: { kind: 'esplora', api: 'https://mempool.space/api' },
    tokens: [],
    explorerAddress: 'https://mempool.space/address/{address}',
    explorerTx: 'https://mempool.space/tx/{tx}',
    send: false,
  },
  ltc: {
    id: 'ltc',
    name: 'Litecoin',
    coin: 'LTC',
    decimals: 8,
    address: 'ltc',
    balance: { kind: 'esplora', api: 'https://litecoinspace.org/api' },
    tokens: [],
    explorerAddress: 'https://litecoinspace.org/address/{address}',
    explorerTx: 'https://litecoinspace.org/tx/{tx}',
    send: false,
  },
  doge: {
    id: 'doge',
    name: 'Dogecoin',
    coin: 'DOGE',
    decimals: 8,
    address: 'doge',
    balance: { kind: 'blockcypher', coin: 'doge' },
    tokens: [],
    explorerAddress: 'https://blockchair.com/dogecoin/address/{address}',
    explorerTx: 'https://blockchair.com/dogecoin/transaction/{tx}',
    send: false,
  },
  bch: {
    id: 'bch',
    name: 'Bitcoin Cash',
    coin: 'BCH',
    decimals: 8,
    address: 'bch',
    balance: { kind: 'blockchair', coin: 'bitcoin-cash' },
    tokens: [],
    explorerAddress: 'https://blockchair.com/bitcoin-cash/address/{address}',
    explorerTx: 'https://blockchair.com/bitcoin-cash/transaction/{tx}',
    send: false,
  },
  dash: {
    id: 'dash',
    name: 'Dash',
    coin: 'DASH',
    decimals: 8,
    address: 'dash',
    balance: { kind: 'blockcypher', coin: 'dash' },
    tokens: [],
    explorerAddress: 'https://blockchair.com/dash/address/{address}',
    explorerTx: 'https://blockchair.com/dash/transaction/{tx}',
    send: false,
  },
  zec: {
    id: 'zec',
    name: 'Zcash',
    coin: 'ZEC',
    decimals: 8,
    address: 'zec',
    balance: { kind: 'blockchair', coin: 'zcash' },
    tokens: [],
    explorerAddress: 'https://blockchair.com/zcash/address/{address}',
    explorerTx: 'https://blockchair.com/zcash/transaction/{tx}',
    send: false,
  },
  xrp: {
    id: 'xrp',
    name: 'XRP Ledger',
    coin: 'XRP',
    decimals: 6,
    address: 'xrp',
    balance: { kind: 'xrpl', rpc: 'https://xrplcluster.com' },
    tokens: [],
    explorerAddress: 'https://livenet.xrpl.org/accounts/{address}',
    explorerTx: 'https://livenet.xrpl.org/transactions/{tx}',
    send: false,
  },
  tron: {
    id: 'tron',
    name: 'Tron',
    coin: 'TRX',
    decimals: 6,
    address: 'tron',
    balance: { kind: 'trongrid', api: 'https://api.trongrid.io' },
    tokens: [USDT('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')],
    explorerAddress: 'https://tronscan.org/#/address/{address}',
    explorerTx: 'https://tronscan.org/#/transaction/{tx}',
    send: false,
  },
  ton: {
    id: 'ton',
    name: 'TON',
    coin: 'TON',
    decimals: 9,
    address: 'ton',
    balance: { kind: 'toncenter', api: 'https://toncenter.com/api/v2' },
    tokens: [],
    explorerAddress: 'https://tonviewer.com/{address}',
    explorerTx: 'https://tonviewer.com/transaction/{tx}',
    send: false,
  },
  near: {
    id: 'near',
    name: 'NEAR',
    coin: 'NEAR',
    decimals: 24,
    address: 'near',
    balance: { kind: 'near', rpc: 'https://free.rpc.fastnear.com' },
    tokens: [],
    explorerAddress: 'https://nearblocks.io/address/{address}',
    explorerTx: 'https://nearblocks.io/txns/{tx}',
    send: false,
  },
  sui: {
    id: 'sui',
    name: 'Sui',
    coin: 'SUI',
    decimals: 9,
    address: 'sui',
    balance: { kind: 'sui', graphql: 'https://graphql.mainnet.sui.io/graphql' },
    tokens: [USDC('0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC')],
    explorerAddress: 'https://suiscan.xyz/mainnet/account/{address}',
    explorerTx: 'https://suiscan.xyz/mainnet/tx/{tx}',
    send: false,
  },
  aptos: {
    id: 'aptos',
    name: 'Aptos',
    coin: 'APT',
    decimals: 8,
    address: 'aptos',
    balance: { kind: 'aptos', api: 'https://fullnode.mainnet.aptoslabs.com/v1' },
    tokens: [],
    explorerAddress: 'https://explorer.aptoslabs.com/account/{address}?network=mainnet',
    explorerTx: 'https://explorer.aptoslabs.com/txn/{tx}?network=mainnet',
    send: false,
  },
  movement: {
    id: 'movement',
    name: 'Movement',
    coin: 'MOVE',
    decimals: 8,
    address: 'aptos',
    balance: { kind: 'aptos', api: 'https://mainnet.movementnetwork.xyz/v1' },
    tokens: [],
    explorerAddress: 'https://explorer.movementnetwork.xyz/account/{address}?network=mainnet',
    explorerTx: 'https://explorer.movementnetwork.xyz/txn/{tx}?network=mainnet',
    send: false,
  },
  starknet: {
    id: 'starknet',
    name: 'Starknet',
    coin: 'STRK',
    decimals: 18,
    address: 'starknet',
    balance: null,
    tokens: [],
    explorerAddress: 'https://voyager.online/contract/{address}',
    explorerTx: 'https://voyager.online/tx/{tx}',
    send: false,
  },
  cardano: {
    id: 'cardano',
    name: 'Cardano',
    coin: 'ADA',
    decimals: 6,
    address: 'cardano',
    balance: null,
    tokens: [],
    explorerAddress: 'https://cardanoscan.io/address/{address}',
    explorerTx: 'https://cardanoscan.io/transaction/{tx}',
    send: false,
  },
  aleo: {
    id: 'aleo',
    name: 'Aleo',
    coin: 'ALEO',
    decimals: 6,
    address: 'aleo',
    balance: null,
    tokens: [],
    explorerAddress: 'https://explorer.provable.com/address/{address}',
    explorerTx: 'https://explorer.provable.com/transaction/{tx}',
    send: false,
  },
  fogo: {
    id: 'fogo',
    name: 'Fogo',
    coin: 'FOGO',
    decimals: 9,
    address: 'svm',
    balance: { kind: 'svm', rpc: 'https://mainnet.fogo.io' },
    tokens: [],
    explorerAddress: 'https://fogoscan.com/account/{address}',
    explorerTx: 'https://fogoscan.com/tx/{tx}',
    send: true,
  },
};

/**
 * What sending a network's coin leaves behind for fees, in its base units (`lib/networkSend.ts`),
 * and the most one send may cost: the fees come from a public node, which is trusted for state
 * and relaying only, so a transfer whose worst case (`maxFeePerGas × gasLimit`) is above this is
 * refused rather than signed. An L1's fee is cents to a dollar, an L2's a fraction of a cent.
 */
export const SEND_FEE_RESERVE: Partial<Record<NetworkId, bigint>> = {
  eth: 5_000_000_000_000_000n, // 0.005 ETH
  base: 200_000_000_000_000n, // 0.0002 ETH
  arb: 200_000_000_000_000n,
  op: 200_000_000_000_000n,
  scroll: 200_000_000_000_000n,
  abs: 200_000_000_000_000n,
  bsc: 1_000_000_000_000_000n, // 0.001 BNB
  pol: 100_000_000_000_000_000n, // 0.1 POL
  avax: 10_000_000_000_000_000n, // 0.01 AVAX
  gnosis: 10_000_000_000_000_000n, // 0.01 xDAI
  bera: 10_000_000_000_000_000n, // 0.01 BERA
  xlayer: 1_000_000_000_000_000n, // 0.001 OKB
  plasma: 10_000_000_000_000_000n, // 0.01 XPL
  fogo: 10_000_000n, // 0.01 FOGO
};

/**
 * How the Wallet tab and Receive group the networks: by the address they share, in the order a
 * person looks for them. Every network is in exactly one group (`tests/unit/networks.test.ts`).
 */
export const NETWORK_GROUPS: readonly { kind: 'stellar' | AddressKind; networks: readonly NetworkId[] }[] = [
  { kind: 'stellar', networks: ['stellar'] },
  {
    kind: 'evm',
    networks: ['eth', 'base', 'arb', 'op', 'bsc', 'pol', 'avax', 'monad', 'gnosis', 'bera', 'scroll', 'xlayer', 'abs', 'plasma', 'hood', 'hypercore'],
  },
  { kind: 'svm', networks: ['solana', 'fogo'] },
  { kind: 'btc', networks: ['btc'] },
  { kind: 'tron', networks: ['tron'] },
  { kind: 'ton', networks: ['ton'] },
  { kind: 'xrp', networks: ['xrp'] },
  { kind: 'near', networks: ['near'] },
  { kind: 'sui', networks: ['sui'] },
  { kind: 'aptos', networks: ['aptos', 'movement'] },
  { kind: 'ltc', networks: ['ltc'] },
  { kind: 'doge', networks: ['doge'] },
  { kind: 'bch', networks: ['bch'] },
  { kind: 'dash', networks: ['dash'] },
  { kind: 'zec', networks: ['zec'] },
  { kind: 'cardano', networks: ['cardano'] },
  { kind: 'starknet', networks: ['starknet'] },
  { kind: 'aleo', networks: ['aleo'] },
];

/**
 * The genesis hash of each SVM network (`getGenesisHash`, read 2026-10-28). Solana and Fogo share
 * one key, so a Fogo transfer signed over a blockhash Solana accepts would be spendable on Solana
 * too; `lib/networkSend.ts` checks the node is Fogo's and that Solana does not know the blockhash.
 */
export const SVM_GENESIS_HASH: Partial<Record<NetworkId, string>> = {
  solana: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  fogo: 'CDLtwKnaCoK157uaHQDj4fHu72AyD2519Cphmpiq6hvT',
};

/** How long a read balance is reused before the next one (the networks are many, the APIs public). */
export const NETWORK_BALANCE_TTL_MS = 60_000;
/** One balance request, end to end. */
export const NETWORK_BALANCE_TIMEOUT_MS = 12_000;
