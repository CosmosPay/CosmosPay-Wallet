/**
 * The wallet's test mode, network by network (constants/testnets.ts): which networks have a test
 * network here, what each one is there — its name, its balance source, its explorers, no tokens
 * — and the address the same key has on it. A main network's definition never answers for a test
 * one: whatever has no test network here is absent in test mode.
 */
import { bech32 } from '@scure/base';
import type { ChainNet } from '@/constants/chains';
import { NETWORKS, SEND_FEE_RESERVE, SVM_GENESIS_HASH, type NetworkDef, type NetworkId } from '@/constants/networks';
import { LEGACY_TEST_NETWORKS, TESTNETS, TEST_SEND_FEE_RESERVE, TEST_SVM_GENESIS_HASH } from '@/constants/testnets';

export function hasTestNetwork(id: NetworkId): boolean {
  return LEGACY_TEST_NETWORKS.includes(id) || Object.hasOwn(TESTNETS, id);
}

/**
 * The network as it is in `env`: the main definition, or the test network's — coin only, and
 * sending where the wallet can bind a signature to it (an EVM test network's chain id, Fogo
 * testnet's checked genesis). Null when the network has no test network the wallet can read.
 */
export function networkDefOn(id: NetworkId, env: ChainNet): NetworkDef | null {
  if (env === 'mainnet') return NETWORKS[id];
  const test = TESTNETS[id];
  if (!test) return null;
  return {
    ...NETWORKS[id],
    name: test.name,
    evmChainId: test.evmChainId,
    balance: test.balance,
    tokens: [],
    explorerAddress: test.explorerAddress,
    explorerTx: test.explorerTx,
    send: test.balance.kind === 'evm' ? test.evmChainId !== undefined : test.balance.kind === 'svm' && !!TEST_SVM_GENESIS_HASH[id],
  };
}

/** Whether the wallet sends on the network in `env` (Stellar's, Solana's and Monad's test networks keep their own paths). */
export function sendsOn(id: NetworkId, env: ChainNet): boolean {
  if (env === 'mainnet') return NETWORKS[id].send;
  return LEGACY_TEST_NETWORKS.includes(id) || !!networkDefOn(id, env)?.send;
}

/** What one send may cost in the network's coin, at most, in `env` (a test network keeps its main one's). */
export function sendFeeReserveOn(id: NetworkId, env: ChainNet): bigint {
  return (env === 'testnet' ? TEST_SEND_FEE_RESERVE[id] : undefined) ?? SEND_FEE_RESERVE[id] ?? 0n;
}

/** The genesis hash an SVM network's node must answer in `env`. */
export function svmGenesisOn(id: NetworkId, env: ChainNet): string | undefined {
  return env === 'mainnet' ? SVM_GENESIS_HASH[id] : TEST_SVM_GENESIS_HASH[id];
}

/** The test network's name, where the network has one here; the main name otherwise. */
export function networkNameOn(id: NetworkId, env: ChainNet): string {
  return (env === 'testnet' && TESTNETS[id]?.name) || NETWORKS[id].name;
}

/** The human-readable part a test network's segwit addresses use, per main network's. */
const TEST_HRP: Partial<Record<NetworkId, { main: string; test: string }>> = {
  btc: { main: 'bc', test: 'tb' },
  ltc: { main: 'ltc', test: 'tltc' },
};

/**
 * The same key's address on the test network: the same string everywhere the format does not
 * name the network, the witness program re-encoded where it does (Bitcoin `tb1…`, Litecoin
 * `tltc1…`). Null for a network with no test network, or an address that is not the expected one.
 */
export function testnetAddress(id: NetworkId, address: string): string | null {
  if (!hasTestNetwork(id)) return null;
  const hrp = TEST_HRP[id];
  if (!hrp) return address;
  try {
    const { prefix, words } = bech32.decode(address as `${string}1${string}`);
    return prefix === hrp.main ? bech32.encode(hrp.test, words) : null;
  } catch {
    return null;
  }
}
