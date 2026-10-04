/**
 * Solana devnet and Monad testnet: where a test send goes, what it is signed for, and
 * what it refuses before anything is signed. The node is a stubbed `fetch`, so each case
 * also pins WHICH node the wallet asked — a test send that reached a mainnet node would
 * be a real payment.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chainAddressesFromMnemonic } from '@/lib/chainAddresses';
import { chainSecret } from '@/lib/chainKeys';
import { ChainSwapRefused, chainBalances, isChainAddress, sendTransfer } from '@/lib/chainSwap';
import { chainRpcUrl } from '@/lib/endpoints';
import { hexToBytes } from '@/lib/evmTx';
import {
  CHAIN_TESTNET_TOKENS,
  MONAD_CHAIN_ID,
  MONAD_TESTNET_CHAIN_ID,
  SOLANA_RENT_EXEMPT_LAMPORTS,
} from '@/constants/chains';
import { DEFAULT_MONAD_TESTNET_RPC_URL, DEFAULT_SOLANA_TESTNET_RPC_URL } from '@/constants/backends';
import { T } from '@/lib/i18n';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SOL_DEST = '13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK';
const EVM_DEST = '0x000000000000000000000000000000000000dEaD';

type Call = { url: string; method: string; params: unknown[] };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer each JSON-RPC method from `answers`; record every call. */
function stubNode(answers: Record<string, unknown>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    const { method, params, id } = JSON.parse(init.body);
    calls.push({ url, method, params });
    if (!(method in answers)) throw new Error(`unexpected ${method}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: answers[method] }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const refusal = async (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: unknown) => e instanceof ChainSwapRefused && e.code === code);

test('the test networks resolve to devnet and Monad testnet, never mainnet', () => {
  assert.equal(chainRpcUrl('solana', 'testnet'), DEFAULT_SOLANA_TESTNET_RPC_URL);
  assert.equal(chainRpcUrl('monad', 'testnet'), DEFAULT_MONAD_TESTNET_RPC_URL);
  assert.notEqual(chainRpcUrl('solana', 'mainnet'), DEFAULT_SOLANA_TESTNET_RPC_URL);
  assert.notEqual(chainRpcUrl('monad', 'mainnet'), DEFAULT_MONAD_TESTNET_RPC_URL);
});

test('the test tokens are addresses on their own chain', () => {
  for (const chain of ['solana', 'monad'] as const) {
    const [native, ...rest] = CHAIN_TESTNET_TOKENS[chain];
    assert.equal(native.asset, 'native');
    for (const tk of rest) assert.ok(isChainAddress(chain, tk.asset), `${chain} ${tk.symbol}`);
  }
});

test('an address is checked against the chain it is sent on', () => {
  assert.ok(isChainAddress('solana', SOL_DEST));
  assert.ok(!isChainAddress('solana', EVM_DEST));
  assert.ok(isChainAddress('monad', EVM_DEST));
  assert.ok(!isChainAddress('monad', SOL_DEST));
  assert.ok(!isChainAddress('monad', '0x1234'));
});

test('a bad destination is refused before any node is asked', async () => {
  const calls = stubNode({});
  const { solana } = await chainAddressesFromMnemonic(PHRASE);
  const secret = await chainSecret(PHRASE, 'solana', solana);
  await refusal(
    sendTransfer({ chain: 'solana', net: 'testnet', secret, owner: solana, asset: 'native', decimals: 9, to: EVM_DEST, amount: 1n }),
    'address',
  );
  assert.equal(calls.length, 0);
});

test('SOL that cannot open the destination account is refused, on devnet', async () => {
  const calls = stubNode({ getBalance: { value: 0 } });
  const { solana } = await chainAddressesFromMnemonic(PHRASE);
  const secret = await chainSecret(PHRASE, 'solana', solana);
  await refusal(
    sendTransfer({
      chain: 'solana',
      net: 'testnet',
      secret,
      owner: solana,
      asset: 'native',
      decimals: 9,
      to: SOL_DEST,
      amount: SOLANA_RENT_EXEMPT_LAMPORTS - 1n,
    }),
    'rent',
  );
  assert.deepEqual(calls.map((c) => c.url), [DEFAULT_SOLANA_TESTNET_RPC_URL]);
});

test('a SOL test send is broadcast to devnet', async () => {
  const calls = stubNode({
    getLatestBlockhash: { value: { blockhash: SOL_DEST } },
    sendTransaction: 'sig',
  });
  const { solana } = await chainAddressesFromMnemonic(PHRASE);
  const secret = await chainSecret(PHRASE, 'solana', solana);
  const id = await sendTransfer({
    chain: 'solana',
    net: 'testnet',
    secret,
    owner: solana,
    asset: 'native',
    decimals: 9,
    to: SOL_DEST,
    amount: SOLANA_RENT_EXEMPT_LAMPORTS,
  });
  assert.equal(id, 'sig');
  assert.ok(calls.every((c) => c.url === DEFAULT_SOLANA_TESTNET_RPC_URL));
  assert.deepEqual(calls.map((c) => c.method), ['getLatestBlockhash', 'sendTransaction']);
});

const hex = (n: number | bigint) => `0x${n.toString(16)}`;

test('a Monad test send is signed for Monad testnet’s chain id', async () => {
  const calls = stubNode({
    eth_chainId: hex(MONAD_TESTNET_CHAIN_ID),
    eth_getTransactionCount: '0x0',
    eth_maxPriorityFeePerGas: '0x1',
    eth_getBlockByNumber: { baseFeePerGas: '0x1' },
    eth_estimateGas: hex(21000),
    eth_sendRawTransaction: '0xhash',
  });
  const { monad } = await chainAddressesFromMnemonic(PHRASE);
  const secret = await chainSecret(PHRASE, 'monad', monad);
  await sendTransfer({ chain: 'monad', net: 'testnet', secret, owner: monad, asset: 'native', decimals: 18, to: EVM_DEST, amount: 1n });
  assert.ok(calls.every((c) => c.url === DEFAULT_MONAD_TESTNET_RPC_URL));
  const raw = calls.find((c) => c.method === 'eth_sendRawTransaction')!.params[0] as string;
  const bytes = hexToBytes(raw);
  assert.equal(bytes[0], 2, 'EIP-1559 envelope');
  // RLP list header, then the first field: the chain id.
  const header = bytes[1] >= 0xf8 ? 1 + (bytes[1] - 0xf7) : 1;
  const at = 1 + header;
  const len = bytes[at] - 0x80;
  const chainId = Number(BigInt(`0x${[...bytes.slice(at + 1, at + 1 + len)].map((b) => b.toString(16).padStart(2, '0')).join('')}`));
  assert.equal(chainId, MONAD_TESTNET_CHAIN_ID);
});

test('a Monad testnet node that is really mainnet is refused, for sends and for balances', async () => {
  stubNode({ eth_chainId: hex(MONAD_CHAIN_ID) });
  const { monad } = await chainAddressesFromMnemonic(PHRASE);
  const secret = await chainSecret(PHRASE, 'monad', monad);
  await refusal(
    sendTransfer({ chain: 'monad', net: 'testnet', secret, owner: monad, asset: 'native', decimals: 18, to: EVM_DEST, amount: 1n }),
    'testnetNode',
  );
  await refusal(chainBalances('monad', monad, 'testnet'), 'testnetNode');
});

test('the test-network refusals have a sentence in every language', () => {
  for (const code of ['testnetNode', 'rent']) {
    const entry = T[`xswap.refused.${code}`];
    assert.ok(entry, `xswap.refused.${code} is missing`);
    for (const lang of ['es', 'en', 'pt', 'de', 'fr'] as const) assert.ok(entry[lang], `xswap.refused.${code}.${lang}`);
  }
});
