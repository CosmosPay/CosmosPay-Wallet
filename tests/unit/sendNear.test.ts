/**
 * Paying NEAR (src/lib/send/near.ts), against stubbed nodes. Pinned: the borsh transaction, its
 * signature and its id against a published vector; the protocol's gas against what NEAR testnet
 * itself burnt for transfers this sender signed; and every refusal — a node of another network,
 * a block hash the main network knows (in test mode), an account never funded, a fee or an amount
 * the balance cannot carry, a recipient that is not one — with nothing broadcast.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base58, base64 } from '@scure/base';
import { NETWORKS } from '@/constants/networks';
import { NEAR_CHAIN } from '@/constants/nearSend';
import { TESTNETS } from '@/constants/testnets';
import { isNearAddress, nearTransferCost, nearTransferGas, nearTransferTx, parseNearAccount, sendNear, signNearTx } from '@/lib/send/near';
import type { FamilyTransfer } from '@/lib/send/types';
import { networkDefOn } from '@/lib/testnets';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/* ------------------------------ published vector ------------------------------ */

// Trust Wallet wallet-core, tests/chains/NEAR/SignerTests.cpp (NEARSigner.SignTx) and
// SerializationTests.cpp; the unsigned bytes are also near-api-js's
// test/unit/transactions/serialize.test.ts ("serialize transfer tx").
const VECTOR_KEY = '3hoMW1HvnRLSFCLZnvPzWeoGwtdHzke34B2cTHM8rhcbG3TbuLKtShTv3DvyejnXKXKBiV7YPkLeqUHN1ghnqpFv';
const VECTOR_TX =
  '09000000746573742e6e65617200917b3d268d4b58f7fec1b150bd68d69be3ee5d4cc39855e341538465bb77860d01000000000000000d00000077686174657665722e6e6561720fa473fd26901df296be6adc4cc4df34d040efa2435224b6986910e630c2fef6010000000301000000000000000000000000000000';
const VECTOR_SIGNED =
  'CQAAAHRlc3QubmVhcgCRez0mjUtY9/7BsVC9aNab4+5dTMOYVeNBU4Rlu3eGDQEAAAAAAAAADQAAAHdoYXRldmVyLm5lYXIPpHP9JpAd8pa+atxMxN800EDvokNSJLaYaRDmMML+9gEAAAADAQAAAAAAAAAAAAAAAAAAAACWmoMzIYbul1Xkg5MlUlgG4Ymj0tK7S0dg6URD6X4cTyLe7vAFmo6XExAO2m4ZFE2n6KDvflObIHCLodjQIb0B';
const VECTOR_HASH_HEX = 'eea6e680f3ea51a7f667e9a801d0bfadf66e03d41ed54975b3c6006351461b32';

test('a transfer serializes, signs and hashes as the published vector', () => {
  const seed = base58.decode(VECTOR_KEY).slice(0, 32);
  const publicKey = ed25519.getPublicKey(seed);
  assert.equal(bytesToHex(publicKey), bytesToHex(base58.decode('Anu7LYDfpLtkP7E16LT9imXF694BdQaa9ufVkQiwTQxC')));
  const tx = nearTransferTx({
    signerId: 'test.near',
    publicKey,
    nonce: 1n,
    receiverId: 'whatever.near',
    blockHash: base58.decode('244ZQ9cgj3CQ6bWBdytfrJMuMQ1jdXLFGnr4HhvtCTnM'),
    deposit: 1n,
  });
  assert.equal(bytesToHex(tx), VECTOR_TX);
  const { signed, hash } = signNearTx(tx, seed);
  assert.equal(base64.encode(signed), VECTOR_SIGNED);
  assert.equal(hash, base58.encode(hexToBytes(VECTOR_HASH_HEX)));
});

test("the transfer's gas is what NEAR testnet burnt for this sender's transfers (2026-10-29, 1e8 gas price)", () => {
  // tokens_burnt of the transaction outcome (send gas × price) of three transfers signed by
  // sendNear on testnet: to cosmos-wallet-send-295878.testnet (G65oyDh34EXtJuHNAkW17tLE9HqZFTTD645vCXd2iach),
  // to a new implicit account (3mitpoBzWEWBdBcwsFnbqXA2ueZ1oHwgwQvL6ryggvRy) and to a new
  // ETH-implicit one (6CjBbWUDMntd29o6oNKagP9JkVZjdMAQJWa6F3AQenRF).
  const price = 100_000_000n;
  assert.equal(nearTransferGas('named').send * price, 22_318_256_250_000_000_000n);
  assert.equal(nearTransferGas('implicit').send * price, 82_494_768_750_000_000_000n);
  assert.equal(nearTransferGas('eth').send * price, 72_318_256_250_000_000_000n);
  // The named transfer's receipt burnt its execution gas at the same price.
  assert.equal(nearTransferGas('named').exec * price, 22_318_256_250_000_000_000n);
  // Up front, execution gas is bought at 1e9: the most a send costs, refunded down after.
  assert.equal(nearTransferCost('named', price), 22_318_256_250_000_000_000n + 223_182_562_500_000_000_000n);
  assert.ok(nearTransferCost('implicit', price) < 10_000_000_000_000_000_000_000n); // under 0.01 NEAR
});

/* ---------------------------------- recipients ---------------------------------- */

test('recipients: implicit, ETH-implicit and the network’s own named accounts', () => {
  const implicit = 'ab'.repeat(32);
  assert.ok(isNearAddress('near', implicit, 'mainnet'));
  assert.ok(isNearAddress('near', implicit.toUpperCase(), 'testnet'));
  assert.deepEqual(parseNearAccount(implicit.toUpperCase(), 'mainnet'), { id: implicit, kind: 'implicit' });
  assert.deepEqual(parseNearAccount('0x000000000000000000000000000000000000dEaD', 'mainnet'), {
    id: '0x000000000000000000000000000000000000dead',
    kind: 'eth',
  });
  assert.ok(isNearAddress('near', 'alice.near', 'mainnet'));
  assert.ok(isNearAddress('near', 'user_1.sweat', 'mainnet'));
  assert.ok(isNearAddress('near', 'bob-2.testnet', 'testnet'));
  for (const bad of ['alice.testnet', 'Alice.near', 'a', 'alice..near', '-alice.near', 'alice.near.', `${'a'.repeat(60)}.near`, '0s' + 'a'.repeat(40), '0x1234', 'ab'.repeat(31)]) {
    assert.ok(!isNearAddress('near', bad, 'mainnet'), bad);
  }
  assert.ok(!isNearAddress('near', 'alice.near', 'testnet'));
  assert.ok(!isNearAddress('sui', implicit, 'mainnet'));
});

/* ------------------------------------ nodes ------------------------------------- */

const TEST_RPC = TESTNETS.near!.balance.kind === 'near' ? TESTNETS.near!.balance.rpc : '';
const MAIN_RPC = NETWORKS.near.balance?.kind === 'near' ? NETWORKS.near.balance.rpc : '';
const BLOCK = base58.encode(new Uint8Array(32).fill(9));
const NEAR = 10n ** 24n;

type Answer = (params: Record<string, unknown>) => { result?: unknown; error?: unknown };
type Node = Record<string, Answer>;

/** Answer each call by node and method (`query:<request_type>` for queries); record `rpc:method`. */
function nodes(byUrl: Record<string, Node>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const { method, params } = JSON.parse(String(init.body)) as { method: string; params: Record<string, unknown> };
    const key = method === 'query' ? `query:${params.request_type}` : method;
    const node = byUrl[url];
    if (!node) throw new TypeError('fetch failed');
    calls.push(`${url === MAIN_RPC ? 'main' : 'test'}:${key}`);
    const answer = node[key];
    if (!answer) throw new Error(`unexpected ${key}`);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, ...answer(params) }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const seed = () => Uint8Array.from({ length: 32 }, (_, i) => i + 7);
const ownerOf = (s: Uint8Array) => bytesToHex(ed25519.getPublicKey(s));

interface NodeOpts {
  env?: 'mainnet' | 'testnet';
  chainId?: string;
  genesis?: string;
  balance?: bigint;
  storage?: number;
  gasPrice?: string;
  key?: () => { result?: unknown; error?: unknown };
  sendTx?: Answer;
  named?: string[];
}

function nearNode(o: NodeOpts = {}): Node {
  const env = o.env ?? 'testnet';
  return {
    status: () => ({ result: { chain_id: o.chainId ?? NEAR_CHAIN[env].chainId, genesis_hash: o.genesis ?? NEAR_CHAIN[env].genesisHash } }),
    'query:view_access_key': o.key ?? (() => ({ result: { nonce: 41, permission: 'FullAccess', block_hash: BLOCK, block_height: 100 } })),
    block: () => ({ result: { header: { hash: BLOCK, height: 100 } } }),
    'query:view_account': (params) =>
      (o.named ?? []).includes(String(params.account_id)) || params.account_id === ownerOf(seed())
        ? { result: { amount: String(o.balance ?? 5n * NEAR), locked: '0', storage_usage: o.storage ?? 182 } }
        : { error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT', info: {} } } },
    gas_price: () => ({ result: { gas_price: o.gasPrice ?? '100000000' } }),
    send_tx: o.sendTx ?? (() => ({ result: { status: { SuccessValue: '' }, transaction: {} } })),
  };
}

/** The main network's node, as a test-mode send asks it: it does not know the test block. */
const mainNode = (knows = false): Node => ({
  block: () => (knows ? { result: { header: { hash: BLOCK } } } : { error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_BLOCK', info: {} } } }),
});

function transfer(over: Partial<FamilyTransfer> = {}): FamilyTransfer {
  const secret = seed();
  const env = over.env ?? 'testnet';
  return {
    network: 'near',
    env,
    def: networkDefOn('near', env)!,
    secret,
    owner: ownerOf(secret),
    asset: 'native',
    to: 'bob.testnet',
    amount: NEAR,
    maxFee: 10n ** 22n,
    ...over,
  };
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};

const sent = (calls: string[]) => calls.some((c) => c.endsWith(':send_tx'));

/* ------------------------------------ sends ------------------------------------- */

test('a test-network send is signed over a block only the test network knows, then broadcast', async () => {
  let signedTx = '';
  const calls = nodes({
    [TEST_RPC]: nearNode({
      named: ['bob.testnet'],
      sendTx: (params) => {
        signedTx = String(params.signed_tx_base64);
        assert.equal(params.wait_until, 'EXECUTED_OPTIMISTIC');
        return { result: { status: { SuccessValue: '' }, transaction: {} } };
      },
    }),
    [MAIN_RPC]: mainNode(),
  });
  const p = transfer();
  const hash = await sendNear(p, 0);
  // The main node is asked about the block before anything is broadcast.
  assert.ok(calls.indexOf('main:block') >= 0 && calls.indexOf('main:block') < calls.indexOf('test:send_tx'));

  const signed = base64.decode(signedTx);
  const publicKey = ed25519.getPublicKey(p.secret);
  const tx = nearTransferTx({ signerId: p.owner, publicKey, nonce: 42n, receiverId: 'bob.testnet', blockHash: base58.decode(BLOCK), deposit: NEAR });
  assert.equal(bytesToHex(signed.subarray(0, tx.length)), bytesToHex(tx));
  assert.equal(signed[tx.length], 0);
  assert.ok(ed25519.verify(signed.subarray(tx.length + 1), sha256(tx), publicKey));
  assert.equal(hash, base58.encode(sha256(tx)));
});

test('a mainnet send pays a pasted, checksummed 0x account as its lowercase ETH-implicit id', async () => {
  let signedTx = '';
  const calls = nodes({
    [MAIN_RPC]: nearNode({
      env: 'mainnet',
      sendTx: (params) => {
        signedTx = String(params.signed_tx_base64);
        return { result: { status: { SuccessValue: '' } } };
      },
    }),
  });
  await sendNear(transfer({ env: 'mainnet', def: networkDefOn('near', 'mainnet')!, to: '0x000000000000000000000000000000000000dEaD' }), 0);
  assert.ok(sent(calls));
  assert.equal(calls.filter((c) => c === 'main:block').length, 1); // the final block to sign over, nothing more
  assert.ok(new TextDecoder().decode(base64.decode(signedTx)).includes('0x000000000000000000000000000000000000dead'));
});

test('a node of another network is refused before anything is signed', async () => {
  for (const node of [nearNode({ chainId: 'mainnet' }), nearNode({ genesis: NEAR_CHAIN.mainnet.genesisHash })]) {
    const calls = nodes({ [TEST_RPC]: node, [MAIN_RPC]: mainNode() });
    assert.equal(await refusal(sendNear(transfer(), 0)), 'chain');
    assert.ok(!sent(calls));
  }
});

test('in test mode, a block hash the main network knows — or cannot say — is refused: the key moves real NEAR too', async () => {
  const known = nodes({ [TEST_RPC]: nearNode({ named: ['bob.testnet'] }), [MAIN_RPC]: mainNode(true) });
  assert.equal(await refusal(sendNear(transfer(), 0)), 'chain');
  assert.ok(!sent(known));
  // the main node unreachable
  const unknown = nodes({ [TEST_RPC]: nearNode({ named: ['bob.testnet'] }) });
  assert.equal(await refusal(sendNear(transfer(), 0)), 'chain');
  assert.ok(!sent(unknown));
});

test('an account never funded has no key: unfunded, however the node says it', async () => {
  const missingKey = () => ({ result: { block_hash: BLOCK, block_height: 1, error: 'access key does not exist while viewing', logs: [] } });
  const missingAccount = () => ({ error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT', info: {} } } });
  for (const key of [missingKey, missingAccount]) {
    const calls = nodes({ [TEST_RPC]: nearNode({ key }), [MAIN_RPC]: mainNode() });
    assert.equal(await refusal(sendNear(transfer(), 0)), 'unfunded');
    assert.ok(!sent(calls));
  }
});

test('a gas price a node inflates, or a fee cap below the cost, is refused, not paid', async () => {
  const inflated = nodes({ [TEST_RPC]: nearNode({ named: ['bob.testnet'], gasPrice: '100000000000000' }), [MAIN_RPC]: mainNode() });
  assert.equal(await refusal(sendNear(transfer(), 0)), 'fee');
  assert.ok(!sent(inflated));
  const capped = nodes({ [TEST_RPC]: nearNode({ named: ['bob.testnet'] }), [MAIN_RPC]: mainNode() });
  assert.equal(await refusal(sendNear(transfer({ maxFee: nearTransferCost('named', 100_000_000n) - 1n }), 0)), 'fee');
  assert.ok(!sent(capped));
});

test('the amount plus the up-front cost must fit the balance, and a grown account keeps its storage stake', async () => {
  const cost = nearTransferCost('named', 100_000_000n);
  const short = nodes({ [TEST_RPC]: nearNode({ named: ['bob.testnet'], balance: NEAR + cost - 1n }), [MAIN_RPC]: mainNode() });
  assert.equal(await refusal(sendNear(transfer(), 0)), 'funds');
  assert.ok(!sent(short));
  // 182 bytes: a zero-balance account, which may be emptied to the last yocto.
  const exact = nodes({ [TEST_RPC]: nearNode({ named: ['bob.testnet'], balance: NEAR + cost }), [MAIN_RPC]: mainNode() });
  await sendNear(transfer(), 0);
  assert.ok(sent(exact));
  // 1 000 bytes keep 0.01 NEAR.
  const stake = nodes({ [TEST_RPC]: nearNode({ named: ['bob.testnet'], balance: NEAR + cost + 9n * 10n ** 21n, storage: 1000 }), [MAIN_RPC]: mainNode() });
  assert.equal(await refusal(sendNear(transfer(), 0)), 'funds');
  assert.ok(!sent(stake));
});

test('recipients a transfer cannot pay, tokens and empty amounts are refused before any node is asked to sign', async () => {
  const calls = nodes({ [TEST_RPC]: nearNode(), [MAIN_RPC]: mainNode() });
  assert.equal(await refusal(sendNear(transfer({ to: 'nobody.testnet' }), 0)), 'address'); // a named account that does not exist
  assert.equal(await refusal(sendNear(transfer({ to: 'alice.near' }), 0)), 'address'); // the main network's name in test mode
  assert.equal(await refusal(sendNear(transfer({ to: 'Bob.testnet' }), 0)), 'address');
  assert.equal(await refusal(sendNear(transfer({ to: 'bob.testnet', asset: 'usdt.tether-token.near' }), 0)), 'address');
  assert.equal(await refusal(sendNear(transfer({ to: 'ab'.repeat(32), amount: 0n }), 0)), 'minimum');
  assert.equal(await refusal(sendNear(transfer({ to: 'ab'.repeat(32), memo: '12345' }), 0)), 'memo');
  assert.equal(await refusal(sendNear(transfer({ def: networkDefOn('sui', 'testnet')! }), 0)), 'chain');
  assert.ok(!sent(calls));
});

test('a key that is not the account’s, or cannot transfer, signs nothing', async () => {
  const calls = nodes({
    [TEST_RPC]: nearNode({ key: () => ({ result: { nonce: 1, permission: { FunctionCall: { receiver_id: 'x.testnet' } } } }) }),
    [MAIN_RPC]: mainNode(),
  });
  assert.match(String(await refusal(sendNear(transfer({ to: 'ab'.repeat(32) }), 0))), /cannot sign transfers/);
  assert.match(String(await refusal(sendNear(transfer({ owner: 'cd'.repeat(32) }), 0))), /does not control/);
  assert.ok(!sent(calls));
});

test("the node's verdict on the broadcast: a timeout is accepted, a balance refusal is funds, a failed receipt an error", async () => {
  const p = transfer({ to: 'ab'.repeat(32) });
  nodes({ [TEST_RPC]: nearNode({ sendTx: () => ({ error: { name: 'HANDLER_ERROR', cause: { name: 'TIMEOUT_ERROR' } } }) }), [MAIN_RPC]: mainNode() });
  assert.match(await sendNear(p, 0), /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  nodes({
    [TEST_RPC]: nearNode({
      sendTx: () => ({ error: { name: 'HANDLER_ERROR', cause: { name: 'INVALID_TRANSACTION' }, data: { TxExecutionError: { InvalidTxError: { NotEnoughBalance: {} } } } } }),
    }),
    [MAIN_RPC]: mainNode(),
  });
  assert.equal(await refusal(sendNear(p, 0)), 'funds');
  nodes({ [TEST_RPC]: nearNode({ sendTx: () => ({ result: { status: { Failure: { ActionError: {} } } } }) }), [MAIN_RPC]: mainNode() });
  assert.match(String(await refusal(sendNear(p, 0))), /failed on chain/);
});
