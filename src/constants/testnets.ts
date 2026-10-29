/**
 * Each network's test network, for the wallet's test mode (the Stellar network pill on
 * "Testnet"): the user's rule, 2026-10-29 — a test mode shows test networks only, never a main
 * network's balance. Stellar, Solana and Monad have theirs through their own paths (the Stellar
 * network setting; `constants/chains.ts` for Solana devnet and Monad testnet). The rest are here,
 * each endpoint public, keyless and open to a browser (CORS), probed 2026-10-29 — the EVM ones
 * answered the chain id written next to them and took a JSON-RPC batch.
 *
 * A network missing here has no test network the wallet can read: in test mode it is not
 * offered at all (no address, no balance, no row) rather than shown with its real funds.
 * Scroll Sepolia had no keyless endpoint that answered; Dogecoin, Bitcoin Cash, Dash and Zcash
 * have no keyless test API; Aleo is not read on its main network either. Cardano's is Preprod.
 *
 * Test networks carry their coin only: a registry token's contract is a main-network one, and
 * the tokens NEAR Intents lists are main-network tokens. The wallet sends that coin on each EVM
 * test network, on Fogo's (see `TEST_SVM_GENESIS_HASH` below) and on the ones in `TEST_SENDS`.
 */
import type { BalanceSource, NetworkId } from '@/constants/networks';

export interface TestnetDef {
  name: string;
  /** EIP-155 id of the test network; asserted like the main one's wherever it is used. */
  evmChainId?: number;
  balance: BalanceSource;
  explorerAddress: string | null;
  explorerTx: string | null;
}

/** The networks whose test network the wallet reaches through another path. */
export const LEGACY_TEST_NETWORKS: readonly NetworkId[] = ['stellar', 'solana', 'monad'];

const evmTest = (name: string, evmChainId: number, rpc: string, explorer: string | null): TestnetDef => ({
  name,
  evmChainId,
  balance: { kind: 'evm', rpc },
  explorerAddress: explorer ? `${explorer}/address/{address}` : null,
  explorerTx: explorer ? `${explorer}/tx/{tx}` : null,
});

export const TESTNETS: Partial<Record<NetworkId, TestnetDef>> = {
  eth: evmTest('Ethereum Sepolia', 11155111, 'https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.etherscan.io'),
  base: evmTest('Base Sepolia', 84532, 'https://base-sepolia-rpc.publicnode.com', 'https://sepolia.basescan.org'),
  arb: evmTest('Arbitrum Sepolia', 421614, 'https://arbitrum-sepolia-rpc.publicnode.com', 'https://sepolia.arbiscan.io'),
  op: evmTest('OP Sepolia', 11155420, 'https://optimism-sepolia-rpc.publicnode.com', 'https://sepolia-optimism.etherscan.io'),
  bsc: evmTest('BNB Chain Testnet', 97, 'https://bsc-testnet-rpc.publicnode.com', 'https://testnet.bscscan.com'),
  pol: evmTest('Polygon Amoy', 80002, 'https://polygon-amoy-bor-rpc.publicnode.com', 'https://amoy.polygonscan.com'),
  avax: evmTest('Avalanche Fuji', 43113, 'https://avalanche-fuji-c-chain-rpc.publicnode.com', 'https://testnet.snowtrace.io'),
  gnosis: evmTest('Gnosis Chiado', 10200, 'https://gnosis-chiado-rpc.publicnode.com', 'https://gnosis-chiado.blockscout.com'),
  bera: evmTest('Berachain Bepolia', 80069, 'https://bepolia.rpc.berachain.com', 'https://testnet.berascan.com'),
  xlayer: evmTest('X Layer Testnet', 1952, 'https://testrpc.xlayer.tech', 'https://www.okx.com/web3/explorer/xlayer-test'),
  abs: evmTest('Abstract Testnet', 11124, 'https://api.testnet.abs.xyz', 'https://sepolia.abscan.org'),
  plasma: evmTest('Plasma Testnet', 9746, 'https://testnet-rpc.plasma.to', 'https://testnet.plasmascan.to'),
  hood: evmTest('Robinhood Chain Testnet', 46630, 'https://rpc.testnet.chain.robinhood.com', null),
  hypercore: {
    name: 'Hyperliquid Testnet',
    balance: { kind: 'hypercore', api: 'https://api.hyperliquid-testnet.xyz/info' },
    explorerAddress: 'https://app.hyperliquid-testnet.xyz/explorer/address/{address}',
    explorerTx: 'https://app.hyperliquid-testnet.xyz/explorer/tx/{tx}',
  },
  fogo: {
    name: 'Fogo Testnet',
    balance: { kind: 'svm', rpc: 'https://testnet.fogo.io' },
    explorerAddress: 'https://fogoscan.com/account/{address}?cluster=testnet',
    explorerTx: 'https://fogoscan.com/tx/{tx}?cluster=testnet',
  },
  btc: {
    name: 'Bitcoin Testnet4',
    balance: { kind: 'esplora', api: 'https://mempool.space/testnet4/api' },
    explorerAddress: 'https://mempool.space/testnet4/address/{address}',
    explorerTx: 'https://mempool.space/testnet4/tx/{tx}',
  },
  ltc: {
    name: 'Litecoin Testnet',
    balance: { kind: 'esplora', api: 'https://litecoinspace.org/testnet/api' },
    explorerAddress: 'https://litecoinspace.org/testnet/address/{address}',
    explorerTx: 'https://litecoinspace.org/testnet/tx/{tx}',
  },
  xrp: {
    name: 'XRP Ledger Testnet',
    balance: { kind: 'xrpl', rpc: 'https://testnet.xrpl-labs.com' },
    explorerAddress: 'https://testnet.xrpl.org/accounts/{address}',
    explorerTx: 'https://testnet.xrpl.org/transactions/{tx}',
  },
  tron: {
    name: 'Tron Nile',
    balance: { kind: 'trongrid', api: 'https://nile.trongrid.io' },
    explorerAddress: 'https://nile.tronscan.org/#/address/{address}',
    explorerTx: 'https://nile.tronscan.org/#/transaction/{tx}',
  },
  ton: {
    name: 'TON Testnet',
    balance: { kind: 'toncenter', api: 'https://testnet.toncenter.com/api/v2' },
    explorerAddress: 'https://testnet.tonviewer.com/{address}',
    explorerTx: 'https://testnet.tonviewer.com/transaction/{tx}',
  },
  near: {
    name: 'NEAR Testnet',
    balance: { kind: 'near', rpc: 'https://rpc.testnet.fastnear.com' },
    explorerAddress: 'https://testnet.nearblocks.io/address/{address}',
    explorerTx: 'https://testnet.nearblocks.io/txns/{tx}',
  },
  sui: {
    name: 'Sui Testnet',
    balance: { kind: 'sui', graphql: 'https://graphql.testnet.sui.io/graphql' },
    explorerAddress: 'https://suiscan.xyz/testnet/account/{address}',
    explorerTx: 'https://suiscan.xyz/testnet/tx/{tx}',
  },
  aptos: {
    name: 'Aptos Testnet',
    balance: { kind: 'aptos', api: 'https://fullnode.testnet.aptoslabs.com/v1' },
    explorerAddress: 'https://explorer.aptoslabs.com/account/{address}?network=testnet',
    explorerTx: 'https://explorer.aptoslabs.com/txn/{tx}?network=testnet',
  },
  cardano: {
    name: 'Cardano Preprod',
    balance: { kind: 'yoroi', api: 'https://preprod-backend.yoroiwallet.com/api' },
    explorerAddress: 'https://preprod.cardanoscan.io/address/{address}',
    explorerTx: 'https://preprod.cardanoscan.io/transaction/{tx}',
  },
  starknet: {
    name: 'Starknet Sepolia',
    balance: { kind: 'starknet', rpc: 'https://starknet-sepolia-rpc.publicnode.com' },
    explorerAddress: 'https://sepolia.voyager.online/contract/{address}',
    explorerTx: 'https://sepolia.voyager.online/tx/{tx}',
  },
  movement: {
    name: 'Movement Testnet',
    balance: { kind: 'aptos', api: 'https://testnet.movementnetwork.xyz/v1' },
    explorerAddress: 'https://explorer.movementnetwork.xyz/account/{address}?network=bardock+testnet',
    explorerTx: 'https://explorer.movementnetwork.xyz/txn/{tx}?network=bardock+testnet',
  },
};

/**
 * Sending on a test network (`lib/networkSend.ts` with `env: 'testnet'`): every EVM one above —
 * its chain id binds the signature, as on a main network — and Fogo's, whose SVM transfer is
 * bound only by its blockhash, so its node's genesis is checked like the main one's (asked of the
 * node 2026-10-29: a first filter, never the proof). A test network keeps its main network's fee
 * reserve (`SEND_FEE_RESERVE`); the ones below are for a test network whose main one sends
 * nowhere here.
 */
export const TEST_SVM_GENESIS_HASH: Partial<Record<NetworkId, string>> = {
  fogo: '9GGSFo95raqzZxWqKM5tGYvJp5iv4Dm565S4r8h5PEu9',
};

export const TEST_SEND_FEE_RESERVE: Partial<Record<NetworkId, bigint>> = {};

/**
 * The other families whose sender binds a signature to the test network (`lib/send/*`): its chain
 * id or network id is inside what is signed, or its transactions name test-network state. TON's
 * is left out on purpose: a v4R2 transfer signed for the testnet replays on mainnet.
 */
export const TEST_SENDS: readonly NetworkId[] = ['starknet', 'xrp', 'tron', 'aptos', 'movement', 'hypercore', 'btc', 'ltc', 'near', 'sui', 'cardano'];
