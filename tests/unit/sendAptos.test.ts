/**
 * Sending APT on Aptos and MOVE on Movement (src/lib/send/aptos.ts).
 *
 * The bytes are pinned against what the networks' own nodes said of them (2026-10-29):
 *  - a transfer from the Aptos TS SDK's published test key (aptos-ts-sdk
 *    ts-sdk unit-test helper module, `ed25519`, commit 6e99fa3), signed here, which Aptos'
 *    and Movement's mainnet nodes both answered "Simulated transactions must not have a valid
 *    signature" — the node verified the signing message and the authenticator;
 *  - transfers the mainnet nodes simulated successfully, whose hash the node named;
 *  - a transfer this sender broadcast on Movement's test network (Bardock, chain id 250), executed
 *    at ledger version 265936831: its on-chain fields rebuild the same bytes, the on-chain signature
 *    verifies over them, and the hash is the chain's.
 *
 * Then every refusal against a stubbed node, and that nothing is broadcast in any of them.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { NETWORKS, type NetworkDef } from '@/constants/networks';
import { TESTNETS } from '@/constants/testnets';
import { APTOS_CHAIN_ID } from '@/constants/aptosSend';
import {
  aptosAddressOf,
  aptosSignedTx,
  aptosSigningMessage,
  aptosTransferRaw,
  aptosTxHash,
  isAptosAddress,
  parseAptosAddress,
  sendAptos,
} from '@/lib/send/aptos';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const hx = (h: string) => hexToBytes(h.replace(/^0x/, ''));

/* ------------------------------ published / node vectors ------------------------------ */

// aptos-ts-sdk's unit-test helper module, `ed25519`
const SDK_SEED = hx('c5338cd251c22daa8c9c9cc94f498cc8a5c7e1d2e75287a5dda91096fe64efa5');
const SDK_PUBLIC_KEY = '0xde19e5d1880cac87d57484ce9ed2e84cf0f9599f12e7cc3a52e4e7657a763f2c';
const SDK_ADDRESS = '0x978c213990c4833df71548df7ce49d54c759d6b6d932de22b24d56060b7af2aa';

test('an address is sha3-256(public key ‖ 0x00), as the Aptos SDK publishes it', () => {
  const publicKey = ed25519.getPublicKey(SDK_SEED);
  assert.equal(`0x${bytesToHex(publicKey)}`, SDK_PUBLIC_KEY);
  assert.equal(aptosAddressOf(publicKey), SDK_ADDRESS);
});

// The signed bytes Aptos' (chain 1) and Movement's (chain 126) mainnet simulation endpoints both
// refused as carrying a VALID signature. Transfer of 1 octa to 0x1, sequence 0, max gas 2000,
// price 100, expiring at 1 800 000 000.
const VALIDLY_SIGNED: Record<number, string> = {
  1: '978c213990c4833df71548df7ce49d54c759d6b6d932de22b24d56060b7af2aa00000000000000000200000000000000000000000000000000000000000000000000000000000000010d6170746f735f6163636f756e74087472616e736665720002200000000000000000000000000000000000000000000000000000000000000001080100000000000000d007000000000000640000000000000000d2496b00000000010020de19e5d1880cac87d57484ce9ed2e84cf0f9599f12e7cc3a52e4e7657a763f2c40362e48e97ab9c8b06ffccb9b4d2f8f01ec85b3d07bf7b6b822d7e6cf93b9ae91834dbc4e76e5cdbab08bb6bfe6e4d5da1ba720bd36f4a10aeb4e9b24fefaeb0e',
  126: '978c213990c4833df71548df7ce49d54c759d6b6d932de22b24d56060b7af2aa00000000000000000200000000000000000000000000000000000000000000000000000000000000010d6170746f735f6163636f756e74087472616e736665720002200000000000000000000000000000000000000000000000000000000000000001080100000000000000d007000000000000640000000000000000d2496b000000007e0020de19e5d1880cac87d57484ce9ed2e84cf0f9599f12e7cc3a52e4e7657a763f2c40b43a8e981fac69029719039d0ef75b64c79a7103d6d75f02973f4fe11d9e000b2dfb03d4e5ee32f67d6366d084b0dae4bef70516052a4e1c4e7f9dee3f429803',
};

test('a transfer signed here is the one the Aptos and Movement nodes verified as validly signed', () => {
  const publicKey = ed25519.getPublicKey(SDK_SEED);
  for (const chainId of [1, 126]) {
    const raw = aptosTransferRaw({
      sender: parseAptosAddress(SDK_ADDRESS)!,
      sequenceNumber: 0n,
      to: parseAptosAddress('0x1')!,
      amount: 1n,
      maxGasAmount: 2000n,
      gasUnitPrice: 100n,
      expirationSecs: 1_800_000_000n,
      chainId,
    });
    const signed = aptosSignedTx(raw, publicKey, ed25519.sign(aptosSigningMessage(raw), SDK_SEED));
    assert.equal(bytesToHex(signed), VALIDLY_SIGNED[chainId]);
  }
});

// Simulated with an all-zero signature by the mainnet nodes: `success: true`, and the hash the node named.
const SIMULATED = [
  {
    chainId: 1,
    sender: '0xd503b95164384a5ebbccbb5c4bdc8b4a5893d9651e9953abda8e1c22fcc1181d',
    publicKey: '0x8d2a6dc60eaeacf89cba9e53db787d77165c63be218175c24009252eaf57c513',
    sequenceNumber: 31189n,
    nodeHash: '0xf713bf0abe291670ef22eedacbeeab1eab223130c5b1dff5a5c1719c31678bc0',
    signed:
      'd503b95164384a5ebbccbb5c4bdc8b4a5893d9651e9953abda8e1c22fcc1181dd5790000000000000200000000000000000000000000000000000000000000000000000000000000010d6170746f735f6163636f756e74087472616e736665720002204242424242424242424242424242424242424242424242424242424242424242083930000000000000204e00000000000064000000000000008689e36a000000000100208d2a6dc60eaeacf89cba9e53db787d77165c63be218175c24009252eaf57c5134000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  },
  {
    chainId: 126,
    sender: '0xc306237d9eef7bf2973da1569284d9fdfb36de98161710af00b62c531295da2a',
    publicKey: '0xed89b151bbc920e19de32b5bf565a56af5fb29281a6c5a2167d48d12f3e3cd6d',
    sequenceNumber: 90586n,
    nodeHash: '0x973d2611e170b8426437fcb619b84b2645068cf5d0fde913b1dfa4ba6ee79cc0',
    signed:
      'c306237d9eef7bf2973da1569284d9fdfb36de98161710af00b62c531295da2ada610100000000000200000000000000000000000000000000000000000000000000000000000000010d6170746f735f6163636f756e74087472616e736665720002204242424242424242424242424242424242424242424242424242424242424242083930000000000000204e00000000000064000000000000008689e36a000000007e0020ed89b151bbc920e19de32b5bf565a56af5fb29281a6c5a2167d48d12f3e3cd6d4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  },
];

test('the BCS of a transfer and its hash are the ones the mainnet nodes simulated and named', () => {
  for (const v of SIMULATED) {
    const raw = aptosTransferRaw({
      sender: hx(v.sender),
      sequenceNumber: v.sequenceNumber,
      to: parseAptosAddress(`0x${'42'.repeat(32)}`)!,
      amount: 12345n,
      maxGasAmount: 20000n,
      gasUnitPrice: 100n,
      expirationSecs: 1793296774n,
      chainId: v.chainId,
    });
    const signed = aptosSignedTx(raw, hx(v.publicKey), new Uint8Array(64));
    assert.equal(bytesToHex(signed), v.signed);
    assert.equal(aptosTxHash(signed), v.nodeHash);
  }
});

test('a transfer this sender broadcast on Movement testnet rebuilds, verifies and hashes as the chain recorded it', () => {
  // GET https://testnet.movementnetwork.xyz/v1/transactions/by_hash/0xe34b9a33…, version 265936831, success.
  const sender = '0x5576e38a1a31a56b9bf748ace6fab0d395fa1acb49f0a811cfe42fd240fae3dc';
  const publicKey = hx('0x688b7e6599e253c316ba952750e3f5f31991b50c8809c205e8dc42c5546e7a49');
  const signature = hx(
    '0x78e3bb071b0d5ffab42e3fea63b91f03d3ef6fc95f1cd3fc1d54b505624574b3b6fc780a25ae37d52bc1f7f38e59a6434ad11ed860a0c3081b637205dea04c01',
  );
  const raw = aptosTransferRaw({
    sender: hx(sender),
    sequenceNumber: 0n,
    to: hx(sender),
    amount: 100_000n,
    maxGasAmount: 246n,
    gasUnitPrice: 100n,
    expirationSecs: 1793296165n,
    chainId: APTOS_CHAIN_ID.movement.testnet,
  });
  assert.equal(aptosAddressOf(publicKey), sender);
  assert.ok(ed25519.verify(signature, aptosSigningMessage(raw), publicKey));
  assert.equal(aptosTxHash(aptosSignedTx(raw, publicKey, signature)), '0xe34b9a33fd005e7b4005d98abdce71e8ff48b8148d3ef4143c28d82a3f54bee5');
});

test('recipients follow AIP-40: 64 hex digits, or a special address written short', () => {
  const full = `0x${'ab'.repeat(32)}`;
  assert.equal(bytesToHex(parseAptosAddress(full)!), 'ab'.repeat(32));
  assert.equal(bytesToHex(parseAptosAddress(full.toUpperCase().replace('0X', '0x'))!), 'ab'.repeat(32));
  assert.equal(bytesToHex(parseAptosAddress('0x1')!), `${'00'.repeat(31)}01`);
  assert.equal(bytesToHex(parseAptosAddress('0xf')!), `${'00'.repeat(31)}0f`);
  for (const bad of ['0x10', `0x${'a'.repeat(63)}`, `0x${'a'.repeat(65)}`, 'ab'.repeat(32), '0x', `0x${'g'.repeat(64)}`, '']) {
    assert.equal(parseAptosAddress(bad), null, bad);
  }
  assert.ok(isAptosAddress('aptos', full, 'mainnet'));
  assert.ok(isAptosAddress('movement', full, 'testnet'));
  assert.ok(!isAptosAddress('sui', full, 'mainnet'));
  assert.ok(!isAptosAddress('aptos', '0x10', 'mainnet'));
});

/* ------------------------------------ stubbed node ------------------------------------ */

const API = 'https://move.test/v1';
const secret = () => Uint8Array.from(SDK_SEED);
const OWNER = SDK_ADDRESS;
const RECIPIENT = `0x${'42'.repeat(32)}`;

interface NodeState {
  chainId?: number;
  sequence?: bigint | null;
  balance?: bigint;
  gasPrice?: number;
  sim?: (signed: Uint8Array) => { status?: number; body: unknown };
  submit?: { status: number; body: unknown };
}

interface Seen {
  calls: string[];
  simulated: Uint8Array[];
  submitted: Uint8Array[];
}

function moveNode(s: NodeState): Seen {
  const seen: Seen = { calls: [], simulated: [], submitted: [] };
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const path = url.slice(API.length);
    seen.calls.push(`${method} ${path}`);
    const reply = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    if (method === 'GET' && path === '/') return reply({ chain_id: s.chainId ?? 1, ledger_version: '1' });
    if (method === 'GET' && path.endsWith('/resource/0x1::account::Account')) {
      const seq = s.sequence === undefined ? 7n : s.sequence;
      return seq === null
        ? reply({ message: 'Resource not found', error_code: 'resource_not_found' }, 404)
        : reply({ type: '0x1::account::Account', data: { sequence_number: String(seq) } });
    }
    if (method === 'GET' && path.includes('/balance/')) return reply(String(s.balance ?? 100_000_000n));
    if (method === 'GET' && path === '/estimate_gas_price') return reply({ gas_estimate: s.gasPrice ?? 100, prioritized_gas_estimate: 150 });
    if (method === 'POST' && path === '/transactions/simulate') {
      const signed = new Uint8Array(init.body as Uint8Array);
      seen.simulated.push(signed);
      const r = s.sim ? s.sim(signed) : { body: [{ success: true, vm_status: 'Executed successfully', gas_used: '62' }] };
      return reply(r.body, r.status ?? 200);
    }
    if (method === 'POST' && path === '/transactions') {
      seen.submitted.push(new Uint8Array(init.body as Uint8Array));
      const r = s.submit ?? { status: 202, body: { hash: '0x00' } };
      return reply(r.body, r.status);
    }
    throw new Error(`unexpected ${method} ${url}`);
  }) as typeof fetch;
  return seen;
}

const def = (network: 'aptos' | 'movement' = 'aptos', send = true): NetworkDef => ({
  ...NETWORKS[network],
  balance: { kind: 'aptos', api: API },
  send,
});

const transfer = (over: Partial<Parameters<typeof sendAptos>[0]> = {}) => ({
  network: 'aptos' as const,
  env: 'mainnet' as const,
  def: def(),
  secret: secret(),
  owner: OWNER,
  asset: 'native',
  to: RECIPIENT,
  amount: 1_000_000n,
  maxFee: 2_000_000n,
  ...over,
});

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};

/** Read a u64 / chain id back out of a signed transfer's fixed layout (sender 32, seq 8, payload, max gas 8, price 8, expiry 8, chain 1, authenticator 1+1+32+1+64). */
const tail = (signed: Uint8Array) => {
  const raw = signed.subarray(0, signed.length - 99);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const n = raw.length;
  return {
    raw,
    sequence: view.getBigUint64(32, true),
    maxGas: view.getBigUint64(n - 25, true),
    price: view.getBigUint64(n - 17, true),
    chainId: raw[n - 1],
    signature: signed.subarray(signed.length - 64),
  };
};

test('an ordinary send is simulated, signed for the chain with 150 % of the simulated gas, and answered by its hash', async () => {
  const seen = moveNode({ sequence: 7n, sim: () => ({ body: [{ success: true, vm_status: 'Executed successfully', gas_used: '62' }] }) });
  const hash = await sendAptos(transfer());
  assert.equal(seen.submitted.length, 1);
  const signed = seen.submitted[0];
  const t = tail(signed);
  assert.equal(t.sequence, 7n);
  assert.equal(t.maxGas, 93n); // ceil(62 × 1.5)
  assert.equal(t.price, 100n);
  assert.equal(t.chainId, 1);
  assert.ok(ed25519.verify(t.signature, aptosSigningMessage(t.raw), ed25519.getPublicKey(SDK_SEED)));
  assert.equal(hash, aptosTxHash(signed));
  // the simulation carried the zero signature, never a valid one
  assert.deepEqual(tail(seen.simulated[0]).signature, new Uint8Array(64));
});

test('Movement signs for its own chain id, in each mode', async () => {
  for (const env of ['mainnet', 'testnet'] as const) {
    const chainId = APTOS_CHAIN_ID.movement[env];
    const seen = moveNode({ chainId });
    await sendAptos(transfer({ network: 'movement', env, def: def('movement') }));
    assert.equal(tail(seen.submitted[0]).chainId, chainId);
  }
  assert.equal(TESTNETS.movement?.balance.kind, 'aptos');
});

test("an account's first send (coins received, no Account resource yet) signs sequence 0 with the whole gas ceiling", async () => {
  // AIP-115: the prologue asks a first transaction for the gas that creating the account costs.
  const seen = moveNode({ sequence: null, balance: 10_000_000n, sim: () => ({ body: [{ success: true, vm_status: 'Executed successfully', gas_used: '5300' }] }) });
  await sendAptos(transfer({ amount: 1_000_000n, maxFee: 2_000_000n }));
  const t = tail(seen.submitted[0]);
  assert.equal(t.sequence, 0n);
  assert.equal(t.maxGas, 20_000n); // min(maxFee / price, (balance − amount) / price)
});

test('a node of another network is refused before anything is signed', async () => {
  for (const chainId of [2, 126, 250]) {
    const seen = moveNode({ chainId });
    assert.equal(await refusal(sendAptos(transfer())), 'chain');
    assert.deepEqual(seen.simulated, []);
    assert.deepEqual(seen.submitted, []);
  }
  // Movement's main node answering in test mode
  const seen = moveNode({ chainId: 126 });
  assert.equal(await refusal(sendAptos(transfer({ network: 'movement', env: 'testnet', def: def('movement') }))), 'chain');
  assert.deepEqual(seen.calls, ['GET /']);
});

test('a definition that does not send, or is not a Move network, is refused without a request', async () => {
  const seen = moveNode({});
  assert.equal(await refusal(sendAptos(transfer({ def: def('aptos', false) }))), 'chain');
  assert.equal(await refusal(sendAptos(transfer({ network: 'sui', def: { ...NETWORKS.sui, send: true } }))), 'chain');
  assert.deepEqual(seen.calls, []);
});

test('only the coin, to a Move address, of a positive amount', async () => {
  const seen = moveNode({});
  assert.equal(await refusal(sendAptos(transfer({ asset: '0x1::fake::Coin' }))), 'address');
  assert.equal(await refusal(sendAptos(transfer({ to: '0x10' }))), 'address');
  assert.equal(await refusal(sendAptos(transfer({ to: '0x000000000000000000000000000000000000dEaD' }))), 'address');
  assert.equal(await refusal(sendAptos(transfer({ amount: 0n }))), 'minimum');
  assert.deepEqual(seen.calls, []);
});

test('an address nothing was ever sent to is unfunded; one holding less than the amount, short of funds', async () => {
  let seen = moveNode({ sequence: null, balance: 0n });
  assert.equal(await refusal(sendAptos(transfer())), 'unfunded');
  assert.deepEqual(seen.simulated, []);
  seen = moveNode({ sequence: 3n, balance: 999_999n });
  assert.equal(await refusal(sendAptos(transfer({ amount: 1_000_000n }))), 'funds');
  assert.deepEqual(seen.simulated, []);
  assert.deepEqual(seen.submitted, []);
});

test('the amount and the fee together beyond the balance are short of funds', async () => {
  // the balance leaves no gas at all after the amount
  let seen = moveNode({ balance: 1_000_050n });
  assert.equal(await refusal(sendAptos(transfer({ amount: 1_000_000n }))), 'funds');
  assert.deepEqual(seen.submitted, []);
  // it leaves some, and the simulation runs out of it under the balance's ceiling
  seen = moveNode({ balance: 1_005_000n, sim: () => ({ body: [{ success: false, vm_status: 'Out of gas', gas_used: '50' }] }) });
  assert.equal(await refusal(sendAptos(transfer({ amount: 1_000_000n }))), 'funds');
  assert.equal(tail(seen.simulated[0]).maxGas, 50n);
  assert.deepEqual(seen.submitted, []);
  // the node's own verdict
  seen = moveNode({ sim: () => ({ body: [{ success: false, vm_status: 'INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE', gas_used: '0' }] }) });
  assert.equal(await refusal(sendAptos(transfer())), 'funds');
  assert.deepEqual(seen.submitted, []);
});

test('whatever the node says gas costs, one send never costs more than maxFee', async () => {
  // a gas price above the whole cap
  let seen = moveNode({ gasPrice: 3_000_000 });
  assert.equal(await refusal(sendAptos(transfer({ maxFee: 2_000_000n }))), 'fee');
  assert.deepEqual(seen.simulated, []);
  // a transfer that needs more gas than the cap buys
  seen = moveNode({ sim: () => ({ body: [{ success: false, vm_status: 'Out of gas', gas_used: '200' }] }) });
  assert.equal(await refusal(sendAptos(transfer({ maxFee: 20_000n }))), 'fee');
  assert.equal(tail(seen.simulated[0]).maxGas, 200n);
  // a first send whose account creation the cap cannot cover
  seen = moveNode({ sequence: null, sim: () => ({ body: [{ success: false, vm_status: 'MAX_GAS_UNITS_BELOW_MIN_TRANSACTION_GAS_UNITS', gas_used: '0' }] }) });
  assert.equal(await refusal(sendAptos(transfer({ maxFee: 100_000n }))), 'fee');
  // a simulation claiming more gas than it was allowed
  seen = moveNode({ sim: () => ({ body: [{ success: true, vm_status: 'Executed successfully', gas_used: '999999' }] }) });
  assert.equal(await refusal(sendAptos(transfer({ maxFee: 20_000n }))), 'fee');
  assert.deepEqual(seen.submitted, []);
  // and the signed ceiling itself never passes the cap: headroom is clamped to it
  seen = moveNode({ sim: () => ({ body: [{ success: true, vm_status: 'Executed successfully', gas_used: '190' }] }) });
  await sendAptos(transfer({ maxFee: 20_000n }));
  const t = tail(seen.submitted[0]);
  assert.equal(t.maxGas, 200n);
  assert.ok(t.maxGas * t.price <= 20_000n);
});

test('a simulation that fails for another reason is an error, and nothing is broadcast', async () => {
  const seen = moveNode({ sim: () => ({ body: [{ success: false, vm_status: 'Move abort in 0x1::aptos_account: ECANNOT_RESERVED_ADDRESS(0x10005)', gas_used: '9' }] }) });
  const why = await refusal(sendAptos(transfer({ to: '0x1' })));
  assert.match(String(why), /would fail/);
  assert.deepEqual(seen.submitted, []);
});

test('a key that is not the owner account signs nothing', async () => {
  const seen = moveNode({});
  assert.match(String(await refusal(sendAptos(transfer({ owner: RECIPIENT })))), /does not control/);
  assert.deepEqual(seen.calls, []);
});

test('a submission the node rejects is not answered as sent', async () => {
  moveNode({ submit: { status: 400, body: { message: 'Invalid transaction: SEQUENCE_NUMBER_TOO_OLD', error_code: 'vm_error' } } });
  assert.match(String(await refusal(sendAptos(transfer()))), /not accepted/);
});
