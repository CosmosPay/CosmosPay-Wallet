/**
 * Sending on the networks beyond Stellar, Solana and Monad (src/lib/networkSend.ts), against a
 * stubbed node. What is pinned is what keeps a public node from deciding anything: an EVM send is
 * refused when the node serves another chain or when its fees and gas would cost more than the
 * network's fee reserve, and a Fogo send — whose key is Solana's too — is refused when the node is
 * not Fogo's or when Solana would accept the blockhash. In test mode the same holds against the
 * test network: its chain id, its genesis, and a blockhash neither Solana nor Fogo's main network
 * knows; and only its coin is paid. Nothing is broadcast in any of those.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { NETWORKS, SEND_FEE_RESERVE, SVM_GENESIS_HASH } from '@/constants/networks';
import { TESTNETS, TEST_SVM_GENESIS_HASH } from '@/constants/testnets';
import { sendNetworkTransfer } from '@/lib/networkSend';
import { evmAddressOf } from '@/lib/evmTx';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Rpc = { method: string; params: unknown[] };
const hexQ = (n: bigint) => `0x${n.toString(16)}`;

/** Answer each JSON-RPC call by method; record the methods called. */
function node(answers: Record<string, (params: unknown[]) => unknown>): string[] {
  const called: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
    const { method, params } = JSON.parse(String(init.body)) as Rpc;
    called.push(method);
    const answer = answers[method];
    if (!answer) throw new Error(`unexpected ${method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: answer(params) }), { status: 200 });
  }) as typeof fetch;
  return called;
}

const evmSecret = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const svmSecret = () => Uint8Array.from({ length: 32 }, (_, i) => 32 - i);
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};

const baseEvm = (fees: { tip: bigint; base: bigint; gas: bigint }, chainId = NETWORKS.base.evmChainId!) => ({
  eth_chainId: () => hexQ(BigInt(chainId)),
  eth_getTransactionCount: () => '0x0',
  eth_maxPriorityFeePerGas: () => hexQ(fees.tip),
  eth_getBlockByNumber: () => ({ baseFeePerGas: hexQ(fees.base) }),
  eth_estimateGas: () => hexQ(fees.gas),
  eth_sendRawTransaction: () => `0x${'ab'.repeat(32)}`,
});

const evmTransfer = () => {
  const secret = evmSecret();
  return { network: 'base' as const, secret, owner: evmAddressOf(secret), asset: 'native', to: '0x000000000000000000000000000000000000dEaD', amount: 1000n };
};

test('an EVM send at ordinary fees is signed for the chain and broadcast', async () => {
  const called = node(baseEvm({ tip: 1_000_000n, base: 5_000_000n, gas: 21_000n }));
  const hash = await sendNetworkTransfer(evmTransfer());
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.ok(called.includes('eth_sendRawTransaction'));
});

test('a node serving another chain is refused before anything is signed', async () => {
  const called = node(baseEvm({ tip: 1n, base: 1n, gas: 21_000n }, 1));
  assert.equal(await refusal(sendNetworkTransfer(evmTransfer())), 'chain');
  assert.ok(!called.includes('eth_sendRawTransaction'));
});

test('fees or gas a node inflates past the fee reserve are refused, not paid', async () => {
  const reserve = SEND_FEE_RESERVE.base!;
  // a base fee that makes 21 000 gas cost more than the whole reserve
  const inflatedFee = node(baseEvm({ tip: 0n, base: reserve / 21_000n, gas: 21_000n }));
  assert.equal(await refusal(sendNetworkTransfer(evmTransfer())), 'fee');
  assert.ok(!inflatedFee.includes('eth_sendRawTransaction'));
  // an ordinary fee with an absurd gas estimate
  const inflatedGas = node(baseEvm({ tip: 1_000_000n, base: 5_000_000n, gas: 10_000_000_000n }));
  assert.equal(await refusal(sendNetworkTransfer(evmTransfer())), 'fee');
  assert.ok(!inflatedGas.includes('eth_sendRawTransaction'));
});

test('only the coin or a registry token is ever paid out', async () => {
  node(baseEvm({ tip: 1n, base: 1n, gas: 60_000n }));
  const p = { ...evmTransfer(), asset: '0x1111111111111111111111111111111111111111' };
  assert.equal(await refusal(sendNetworkTransfer(p)), 'address');
});

const fogoTransfer = () => {
  const secret = svmSecret();
  const owner = base58.encode(ed25519.getPublicKey(secret));
  return { network: 'fogo' as const, secret, owner, asset: 'native', to: base58.encode(ed25519.getPublicKey(evmSecret())), amount: 5_000_000n };
};
const blockhash = base58.encode(new Uint8Array(32).fill(7));
const fogoNode = (genesis: string, solanaKnowsIt: boolean) => ({
  getGenesisHash: () => genesis,
  getBalance: () => ({ context: { slot: 1 }, value: 1 }),
  getLatestBlockhash: () => ({ context: { slot: 1 }, value: { blockhash, lastValidBlockHeight: 10 } }),
  isBlockhashValid: () => ({ context: { slot: 1 }, value: solanaKnowsIt }),
  sendTransaction: () => base58.encode(new Uint8Array(64).fill(1)),
});

test('a Fogo send over a blockhash only Fogo knows is broadcast', async () => {
  const called = node(fogoNode(SVM_GENESIS_HASH.fogo!, false));
  const id = await sendNetworkTransfer(fogoTransfer(), 0);
  assert.ok(id.length > 40);
  assert.ok(called.includes('sendTransaction'));
});

test('a node that is not Fogo, or a blockhash Solana accepts, is refused: the key moves SOL too', async () => {
  const wrongNode = node(fogoNode(SVM_GENESIS_HASH.solana!, false));
  assert.equal(await refusal(sendNetworkTransfer(fogoTransfer(), 0)), 'chain');
  assert.ok(!wrongNode.includes('sendTransaction'));
  const replayable = node(fogoNode(SVM_GENESIS_HASH.fogo!, true));
  assert.equal(await refusal(sendNetworkTransfer(fogoTransfer(), 0)), 'chain');
  assert.ok(!replayable.includes('sendTransaction'));
});

test('Solana is asked only after the settle wait, so a blockhash too fresh for it is seen by then', async () => {
  // Solana's node "catches up" 30 ms after the blockhash was handed over: asked at once it would
  // not know it; asked after the wait it does, and the send is refused.
  let handedAt = 0;
  const answers = fogoNode(SVM_GENESIS_HASH.fogo!, false);
  const called = node({
    ...answers,
    getLatestBlockhash: () => {
      handedAt = Date.now();
      return answers.getLatestBlockhash();
    },
    isBlockhashValid: () => ({ context: { slot: 1 }, value: Date.now() - handedAt >= 30 }),
  });
  assert.equal(await refusal(sendNetworkTransfer(fogoTransfer(), 50)), 'chain');
  assert.ok(!called.includes('sendTransaction'));
});

test('in test mode an EVM send is signed for the test chain, and only its coin is paid', async () => {
  const sepolia = TESTNETS.base!.evmChainId!;
  const called = node(baseEvm({ tip: 1_000_000n, base: 5_000_000n, gas: 21_000n }, sepolia));
  assert.match(await sendNetworkTransfer({ ...evmTransfer(), env: 'testnet' }), /^0x[0-9a-f]{64}$/);
  assert.ok(called.includes('eth_sendRawTransaction'));
  // a node answering the MAIN chain id in test mode is refused
  const mainNode = node(baseEvm({ tip: 1n, base: 1n, gas: 21_000n }));
  assert.equal(await refusal(sendNetworkTransfer({ ...evmTransfer(), env: 'testnet' })), 'chain');
  assert.ok(!mainNode.includes('eth_sendRawTransaction'));
  // a registry token is a main-network contract: never paid on a test network
  node(baseEvm({ tip: 1n, base: 1n, gas: 60_000n }, sepolia));
  const usdc = NETWORKS.base.tokens[0].asset;
  assert.equal(await refusal(sendNetworkTransfer({ ...evmTransfer(), asset: usdc, env: 'testnet' })), 'address');
});

test('a Fogo testnet send needs its own genesis and a blockhash Fogo mainnet does not know either', async () => {
  const ok = node(fogoNode(TEST_SVM_GENESIS_HASH.fogo!, false));
  assert.ok((await sendNetworkTransfer({ ...fogoTransfer(), env: 'testnet' }, 0)).length > 40);
  assert.ok(ok.includes('sendTransaction'));
  // the main network's genesis is not the test network's
  const mainGenesis = node(fogoNode(SVM_GENESIS_HASH.fogo!, false));
  assert.equal(await refusal(sendNetworkTransfer({ ...fogoTransfer(), env: 'testnet' }, 0)), 'chain');
  assert.ok(!mainGenesis.includes('sendTransaction'));
  // a blockhash Solana does not know but Fogo's MAIN network does: the signature would move real FOGO
  const fogoMain = (NETWORKS.fogo.balance as { rpc: string }).rpc;
  const answers = fogoNode(TEST_SVM_GENESIS_HASH.fogo!, false);
  const sent: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const { method } = JSON.parse(String(init.body)) as Rpc;
    sent.push(method);
    const result = method === 'isBlockhashValid' ? { context: { slot: 1 }, value: String(url) === fogoMain } : answers[method as keyof typeof answers]();
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
  }) as typeof fetch;
  assert.equal(await refusal(sendNetworkTransfer({ ...fogoTransfer(), env: 'testnet' }, 0)), 'chain');
  assert.ok(!sent.includes('sendTransaction'));
});
