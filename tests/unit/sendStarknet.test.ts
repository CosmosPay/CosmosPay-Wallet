/**
 * Sending STRK from the wallet's Argent X account (src/lib/send/starknet.ts).
 *
 * The transaction hashes are checked against vectors from outside this repository: starknet.js's
 * `__tests__/utils/transactionHash.test.ts` (develop, read 2026-10-29) — an INVOKE v3 and a
 * DEPLOY_ACCOUNT v3 that the Sepolia sequencer itself hashed (blocks 15616497 and 15617429), and
 * the fee-field vectors of the Starkware blockifier — and the checksum vector of its
 * `__tests__/utils/address.test.ts`. The key is checked to reproduce the address the wallet shows
 * (`argentAccountAddress`). Against a stubbed node: every refusal, with nothing broadcast, and the
 * two paths that broadcast — a deployed account (one INVOKE) and a first send (DEPLOY_ACCOUNT, then
 * the INVOKE once the deployment executed) — each signature checked against the hash a node would
 * compute from the wire.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToSeedSync } from 'bip39';
import { HDKey } from '@scure/bip32';
import { Signature, getPublicKey, getStarkKey, keccak, verify } from '@scure/starknet';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { DEBUG_WALLET_PHRASE } from '@/constants/debug';
import { NETWORKS, type NetworkDef } from '@/constants/networks';
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  STARKNET_BALANCE_OF_SELECTOR,
  STARKNET_CHAIN_ID,
  STARKNET_QUERY_VERSION,
  STARKNET_TRANSFER_SELECTOR,
  STRK_TOKEN,
} from '@/constants/starknetSend';
import { argentAccountAddress } from '@/lib/addresses/starknet';
import {
  argentDeployment,
  deployAccountHash,
  executeCalldata,
  feeFieldHash,
  invokeHash,
  isStarknetAddress,
  readStarknetBalance,
  sendStarknet,
  starknetChecksumAddress,
  starknetSecret,
  transferCall,
  type ResourceBounds,
} from '@/lib/send/starknet';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const SN_SEPOLIA = 0x534e5f5345504f4c4941n;
const SN_MAIN = 0x534e5f4d41494en;
const hex = (n: bigint) => `0x${n.toString(16)}`;

/* ----------------------------- protocol vectors ----------------------------- */

test('the fee field hashes as the blockifier vectors say', () => {
  const b = (l1: bigint, l1p: bigint, l2: bigint, l2p: bigint, d: bigint, dp: bigint): ResourceBounds => ({
    l1Gas: { maxAmount: l1, maxPrice: l1p },
    l2Gas: { maxAmount: l2, maxPrice: l2p },
    l1DataGas: { maxAmount: d, maxPrice: dp },
  });
  assert.equal(hex(feeFieldHash(0n, b(0x1000n, 0x2000n, 0x3000n, 0x4000n, 0x5000n, 0x6000n))), '0x3d848944220686a0d567e2a3895f3651ad616d4eccb473a03a93150c40b5e13');
  assert.equal(hex(feeFieldHash(0n, b(0x1000n, 0x2000n, 0x3000n, 0x4000n, 0n, 0n))), '0x6916420cf10b91926a408900e0e8f5548bbd3baccb11b2e0ad1a58246b0ffe0');
  // a bound wider than its field would bleed into the next one: refused, never packed
  assert.throws(() => feeFieldHash(0n, b(2n ** 64n, 1n, 0n, 0n, 0n, 0n)), RangeError);
});

test('an INVOKE v3 hashes as the Sepolia sequencer did (block 15616497), its calldata as Cairo 1 multicall', () => {
  const to = 0x248cf60e8ef4895e30dd49801c993ae6271cc52f5207da46c9d81d34f02c029n;
  const calldata = executeCalldata([
    { to, selector: 0x3c06b1ab163ddde6495ff43fed0ed7a913edc2b078bc89d460f235b09f950e8n, calldata: [] },
    { to, selector: 0x5df99ae77df976b4f0e5cf28c7dcfe09bd6e81aab787b19ac0c08e03d928cfn, calldata: [0x1d0n] },
  ]);
  // the transaction's own calldata, as the sequencer received it
  assert.deepEqual(calldata.map(hex), [
    '0x2',
    '0x248cf60e8ef4895e30dd49801c993ae6271cc52f5207da46c9d81d34f02c029',
    '0x3c06b1ab163ddde6495ff43fed0ed7a913edc2b078bc89d460f235b09f950e8',
    '0x0',
    '0x248cf60e8ef4895e30dd49801c993ae6271cc52f5207da46c9d81d34f02c029',
    '0x5df99ae77df976b4f0e5cf28c7dcfe09bd6e81aab787b19ac0c08e03d928cf',
    '0x1',
    '0x1d0',
  ]);
  const hash = invokeHash(0x77dfdc45ba4695eac4c961f3d9bf820ed7e925a44d9963de7b7a0daf8768af0n, calldata, {
    chainId: SN_SEPOLIA,
    nonce: 0x14c1aan,
    version: 3n,
    tip: 0x5f5e100n,
    bounds: {
      l1Gas: { maxAmount: 0x11170n, maxPrice: 0x8d79883d20000n },
      l2Gas: { maxAmount: 0x5f5e100n, maxPrice: 0xba43b7400n },
      l1DataGas: { maxAmount: 0x2710n, maxPrice: 0x62448724953354n },
    },
  });
  assert.equal(hex(hash), '0x381be3aec32afcfe7bbc6c62b7b5050d136424cac29a74022de5385bf4acf7c');
});

test('a DEPLOY_ACCOUNT v3 hashes as the Sepolia sequencer did (block 15617429)', () => {
  const salt = 0x75bde96776c18004db282868166cb249278738af82f536b645a796741f4fcb2n;
  const hash = deployAccountHash(
    {
      address: 0x21b2f3b6f4f707a5630ef1476549951bd7ed401c921580c5b3bb4bd945cd062n,
      classHash: 0x6e150953b26271a740bf2b6e9bca17cc52c68d765f761295de51ceb8526ee72n,
      salt,
      constructorCalldata: [0x1n, 0x2n, salt, 0x9db5d788e62a61c4144ca2c6594434def70200dc38ed4708e10d65f7d5efan],
    },
    {
      chainId: SN_SEPOLIA,
      nonce: 0n,
      version: 3n,
      bounds: {
        l1Gas: { maxAmount: 0n, maxPrice: 0x18c24e65c6dfen },
        l2Gas: { maxAmount: 0x79a707n, maxPrice: 0x1026d6ed66n },
        l1DataGas: { maxAmount: 0x5a7n, maxPrice: 0x281c7ca653cn },
      },
    },
  );
  assert.equal(hex(hash), '0x761a414cb50fecb10f8fac3ccc6f8e38e827a23831ea54e71e765ac4e7f2d78');
});

test('the protocol constants are what their names hash or spell to', () => {
  const sn = (name: string) => keccak(utf8ToBytes(name));
  assert.equal(STARKNET_TRANSFER_SELECTOR, sn('transfer'));
  assert.equal(STARKNET_BALANCE_OF_SELECTOR, sn('balance_of'));
  const short = (s: string) => BigInt(`0x${Buffer.from(s).toString('hex')}`);
  assert.equal(STARKNET_CHAIN_ID.mainnet, short('SN_MAIN'));
  assert.equal(STARKNET_CHAIN_ID.testnet, short('SN_SEPOLIA'));
});

test('a transfer is token.transfer(recipient, u256 low, high) in one __execute__ call', () => {
  const amount = 2n ** 130n + 5n;
  assert.deepEqual(executeCalldata([transferCall(STRK_TOKEN, 0xabcn, amount)]), [
    1n,
    STRK_TOKEN,
    STARKNET_TRANSFER_SELECTOR,
    3n,
    0xabcn,
    5n,
    4n,
  ]);
  assert.throws(() => transferCall(STRK_TOKEN, 0xabcn, 2n ** 256n), RangeError);
});

/* ------------------------------- keys, addresses ----------------------------- */

const debugEvmKey = () => HDKey.fromMasterSeed(new Uint8Array(mnemonicToSeedSync(DEBUG_WALLET_PHRASE))).derive("m/44'/60'/0'/0/0").privateKey!;

test("the Stark key reproduces the Argent address the wallet shows for the debug phrase's EVM key", () => {
  const evmKey = debugEvmKey();
  const secret = starknetSecret(evmKey);
  assert.equal(secret.length, 32);
  const publicKey = BigInt(getStarkKey(secret));
  const deployment = argentDeployment(publicKey);
  assert.equal(deployment.address, BigInt(argentAccountAddress(evmKey)));
  // pinned, so a change on either side is seen (read back from mainnet on 2026-10-29: undeployed)
  assert.equal(hex(deployment.address), '0x3dd58b5ed0d6b73b453599955e61266e7fb6da266f796de8138ff41edd53e7d');
  assert.equal(hex(publicKey), '0x64fb1b0de51ed79a402060e72a1a29b4b3a515cf8035a6cc5c26d1074f6e2b5');
  // what a deployment names: the class, the key as salt, (Signer::Starknet(key), None)
  assert.equal(deployment.classHash, ARGENT_ACCOUNT_CLASS_HASH);
  assert.equal(deployment.salt, publicKey);
  assert.deepEqual(deployment.constructorCalldata, [0n, publicKey, 1n]);
});

test('a recipient is a Starknet contract address, and mixed case must be its checksum', () => {
  // starknet.js's vector
  assert.equal(starknetChecksumAddress(0x2fd23d9182193775423497fc0c472e156c57c69e4089a1967fb288a2d84e914n), '0x02Fd23d9182193775423497fc0c472E156C57C69E4089A1967fb288A2d84e914');
  const ok = (a: string) => isStarknetAddress('starknet', a, 'mainnet');
  assert.ok(ok('0x02Fd23d9182193775423497fc0c472E156C57C69E4089A1967fb288A2d84e914'));
  assert.ok(ok('0x2Fd23d9182193775423497fc0c472E156C57C69E4089A1967fb288A2d84e914')); // unpadded, same letters
  assert.ok(ok('0x02fd23d9182193775423497fc0c472e156c57c69e4089a1967fb288a2d84e914'));
  assert.ok(ok('0x02FD23D9182193775423497FC0C472E156C57C69E4089A1967FB288A2D84E914'));
  assert.ok(isStarknetAddress('starknet', '0x0123abc', 'testnet'));
  assert.ok(!ok('0x02fD23d9182193775423497fc0c472E156C57C69E4089A1967fb288A2d84e914')); // one letter flipped
  assert.ok(!ok('0x0')); // the protocol's own
  assert.ok(!ok('0x2'));
  assert.ok(!ok(hex(2n ** 251n - 256n))); // past the address bound
  assert.ok(!ok(`0x${'1'.repeat(65)}`));
  assert.ok(!ok('02fd23d9182193775423497fc0c472e156c57c69e4089a1967fb288a2d84e914'));
  assert.ok(!ok('0x'));
  assert.ok(!ok('0xg1'));
  assert.ok(!isStarknetAddress('eth', '0x0123abc', 'mainnet'));
});

/* --------------------------------- stub node -------------------------------- */

type Answer = (params: Record<string, unknown>) => unknown;
interface Call {
  method: string;
  params: Record<string, unknown>;
}

/** Answer each JSON-RPC call by method (an `{ error }` object answers an error); record every call. */
function stubNode(answers: Record<string, Answer>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
    const { method, params } = JSON.parse(String(init.body)) as Call;
    calls.push({ method, params });
    const answer = answers[method];
    if (!answer) throw new Error(`unexpected ${method}`);
    const out = answer(params) as { error?: unknown } | unknown;
    const body = out && typeof out === 'object' && 'error' in (out as object) ? { jsonrpc: '2.0', id: 1, ...(out as object) } : { jsonrpc: '2.0', id: 1, result: out };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const secret = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const publicKey = BigInt(getStarkKey(secret()));
const account = argentDeployment(publicKey);
const owner = hex(account.address);
const RECIPIENT = '0x0123456789abcdef';
const def = (tokens: NetworkDef['tokens'] = []): NetworkDef => ({ ...NETWORKS.starknet, send: true, tokens });

const transfer = (over: Partial<Parameters<typeof sendStarknet>[0]> = {}) => ({
  network: 'starknet' as const,
  env: 'mainnet' as const,
  def: def(),
  secret: secret(),
  owner,
  asset: 'native',
  to: RECIPIENT,
  amount: 10n ** 18n,
  maxFee: 10n ** 18n,
  ...over,
});

/** A mainnet estimate of a STRK transfer from this account class, as publicnode answered it on 2026-10-29. */
const ESTIMATE = {
  l1_gas_consumed: '0x0',
  l1_gas_price: '0x3d9ff3a3d882',
  l2_gas_consumed: '0x173cc0',
  l2_gas_price: '0x46459cb8b',
  l1_data_gas_consumed: '0x80',
  l1_data_gas_price: '0x1ff112fc31',
  overall_fee: '0x661eda220854c0',
  unit: 'FRI',
};
/** ×1.5 on every amount and price, rounded up, summed: the cap of one such transaction. */
const ESTIMATE_CAP = 64674832157256864n;

const u256 = (n: bigint) => [hex(n % 2n ** 128n), hex(n / 2n ** 128n)];
const wireBounds = (w: Record<string, unknown>): ResourceBounds => {
  const rb = w.resource_bounds as Record<string, { max_amount: string; max_price_per_unit: string }>;
  const r = (k: string) => ({ maxAmount: BigInt(rb[k].max_amount), maxPrice: BigInt(rb[k].max_price_per_unit) });
  return { l1Gas: r('l1_gas'), l2Gas: r('l2_gas'), l1DataGas: r('l1_data_gas') };
};
/** The hash a node computes from the wire, independent of what the wallet says it signed. */
const nodeHash = (w: Record<string, unknown>, chainId: bigint): bigint => {
  const f = { chainId, nonce: BigInt(w.nonce as string), version: BigInt(w.version as string), bounds: wireBounds(w), tip: BigInt(w.tip as string) };
  if (w.type === 'INVOKE') return invokeHash(BigInt(w.sender_address as string), (w.calldata as string[]).map(BigInt), f);
  const salt = BigInt(w.contract_address_salt as string);
  const calldata = (w.constructor_calldata as string[]).map(BigInt);
  // the node derives the address from the class, salt and calldata; the wallet's must match
  const address = argentDeployment(calldata[1]).address;
  return deployAccountHash({ address, classHash: BigInt(w.class_hash as string), salt, constructorCalldata: calldata }, f);
};

interface NodeState {
  chainId?: bigint;
  deployed?: boolean;
  nonce?: bigint;
  strk?: bigint;
  estimate?: Record<string, string>;
  /** The deployment's status, poll after poll (the last one repeats); an `{ error }` answers an error. */
  deployStatus?: unknown[];
  answerHash?: (real: bigint) => bigint;
}

function starknetNode(s: NodeState = {}): Call[] {
  const chainId = s.chainId ?? SN_MAIN;
  return stubNode({
    starknet_chainId: () => hex(chainId),
    starknet_getClassHashAt: () => (s.deployed === false ? { error: { code: 20, message: 'Contract not found' } } : hex(ARGENT_ACCOUNT_CLASS_HASH)),
    starknet_getNonce: () => hex(s.nonce ?? 7n),
    starknet_call: () => u256(s.strk ?? 5n * 10n ** 18n),
    starknet_estimateFee: (params) => (params.request as unknown[]).map(() => s.estimate ?? ESTIMATE),
    starknet_addInvokeTransaction: (params) => ({
      transaction_hash: hex((s.answerHash ?? ((h) => h))(nodeHash(params.invoke_transaction as Record<string, unknown>, chainId))),
    }),
    starknet_addDeployAccountTransaction: (params) => ({
      transaction_hash: hex(nodeHash(params.deploy_account_transaction as Record<string, unknown>, chainId)),
      contract_address: owner,
    }),
    starknet_getTransactionStatus: () => {
      const answers = s.deployStatus ?? [{ finality_status: 'ACCEPTED_ON_L2', execution_status: 'SUCCEEDED' }];
      return answers.length > 1 ? answers.shift() : answers[0];
    },
  });
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};
const broadcast = (calls: Call[]) => calls.filter((c) => c.method.startsWith('starknet_add'));
const methods = (calls: Call[]) => calls.map((c) => c.method);

/* ------------------------------------ sends ----------------------------------- */

test('a deployed account sends one INVOKE v3, signed over the hash a node computes from the wire', async () => {
  const calls = starknetNode({ nonce: 7n });
  const hash = await sendStarknet(transfer(), 1);
  assert.deepEqual(methods(calls), [
    'starknet_chainId',
    'starknet_getClassHashAt',
    'starknet_call',
    'starknet_getNonce',
    'starknet_estimateFee',
    'starknet_addInvokeTransaction',
  ]);
  // the estimate ran the same call on the QUERY version, validation on
  const est = calls[4].params;
  assert.deepEqual(est.simulation_flags, []);
  const [queried] = est.request as Record<string, unknown>[];
  assert.equal(BigInt(queried.version as string), STARKNET_QUERY_VERSION);

  const tx = broadcast(calls)[0].params.invoke_transaction as Record<string, unknown>;
  assert.equal(tx.version, '0x3');
  assert.equal(tx.nonce, '0x7');
  assert.equal(tx.tip, '0x0');
  assert.deepEqual(tx.paymaster_data, []);
  assert.equal(tx.sender_address, owner);
  assert.deepEqual(tx.calldata, ['0x1', hex(STRK_TOKEN), hex(STARKNET_TRANSFER_SELECTOR), '0x3', hex(BigInt(RECIPIENT)), hex(10n ** 18n), '0x0']);
  const expected = nodeHash(tx, SN_MAIN);
  assert.equal(hash, `0x${expected.toString(16).padStart(64, '0')}`);
  const [r, s] = (tx.signature as string[]).map(BigInt);
  assert.ok(verify(new Signature(r, s), hex(expected), getPublicKey(secret())));
  // the bounds are the estimate ×1.5 and the cap is what the wallet checked against maxFee
  const bounds = wireBounds(tx);
  assert.equal(bounds.l2Gas.maxAmount, (0x173cc0n * 150n + 99n) / 100n);
  assert.equal(bounds.l2Gas.maxPrice, (0x46459cb8bn * 150n + 99n) / 100n);
  assert.equal(bounds.l1Gas.maxAmount, 0n);
});

test('a first send deploys the account with exactly what its address is computed from, then transfers at nonce 1', async () => {
  const calls = starknetNode({ deployed: false, strk: 2n * 10n ** 18n });
  const hash = await sendStarknet(transfer(), 1);
  assert.deepEqual(methods(calls), [
    'starknet_chainId',
    'starknet_getClassHashAt',
    'starknet_call',
    'starknet_estimateFee',
    'starknet_addDeployAccountTransaction',
    'starknet_getTransactionStatus',
    'starknet_addInvokeTransaction',
  ]);
  const estimated = calls[3].params.request as Record<string, unknown>[];
  assert.deepEqual(estimated.map((t) => t.type), ['DEPLOY_ACCOUNT', 'INVOKE']);
  const [deploy, invoke] = broadcast(calls).map((c) => (c.params.deploy_account_transaction ?? c.params.invoke_transaction) as Record<string, unknown>);
  assert.equal(deploy.class_hash, hex(ARGENT_ACCOUNT_CLASS_HASH));
  assert.equal(deploy.contract_address_salt, hex(publicKey));
  assert.deepEqual(deploy.constructor_calldata, ['0x0', hex(publicKey), '0x1']);
  assert.equal(deploy.nonce, '0x0');
  assert.equal(invoke.nonce, '0x1');
  const deployHash = nodeHash(deploy, SN_MAIN);
  const [r, s] = (deploy.signature as string[]).map(BigInt);
  assert.ok(verify(new Signature(r, s), hex(deployHash), getPublicKey(secret())));
  assert.equal(hash, `0x${nodeHash(invoke, SN_MAIN).toString(16).padStart(64, '0')}`);
});

test('a deployment that reverts stops the send before the transfer', async () => {
  const calls = starknetNode({ deployed: false, strk: 2n * 10n ** 18n, deployStatus: [{ finality_status: 'ACCEPTED_ON_L2', execution_status: 'REVERTED' }] });
  assert.match(String(await refusal(sendStarknet(transfer(), 1))), /reverted/);
  assert.deepEqual(broadcast(calls).map((c) => c.method), ['starknet_addDeployAccountTransaction']);
});

test('the transfer waits for the deployment: unseen, received, then executed', async () => {
  const calls = starknetNode({
    deployed: false,
    deployStatus: [
      { error: { code: 29, message: 'Transaction hash not found' } },
      { finality_status: 'RECEIVED' },
      { finality_status: 'PRE_CONFIRMED', execution_status: 'SUCCEEDED' },
    ],
  });
  await sendStarknet(transfer(), 1);
  assert.deepEqual(methods(calls).slice(4), [
    'starknet_addDeployAccountTransaction',
    'starknet_getTransactionStatus',
    'starknet_getTransactionStatus',
    'starknet_getTransactionStatus',
    'starknet_addInvokeTransaction',
  ]);
});

test('test mode signs for Sepolia, and only against a Sepolia node', async () => {
  const calls = starknetNode({ chainId: SN_SEPOLIA });
  await sendStarknet(transfer({ env: 'testnet' }), 1);
  const tx = broadcast(calls)[0].params.invoke_transaction as Record<string, unknown>;
  const [r, s] = (tx.signature as string[]).map(BigInt);
  assert.ok(verify(new Signature(r, s), hex(nodeHash(tx, SN_SEPOLIA)), getPublicKey(secret())));
  assert.ok(!verify(new Signature(r, s), hex(nodeHash(tx, SN_MAIN)), getPublicKey(secret())));
});

/* ---------------------------------- refusals ---------------------------------- */

test('a node serving another network is refused before anything is read or signed', async () => {
  const onMain = starknetNode({ chainId: SN_SEPOLIA });
  assert.equal(await refusal(sendStarknet(transfer(), 1)), 'chain');
  assert.deepEqual(methods(onMain), ['starknet_chainId']);
  const onTest = starknetNode({ chainId: SN_MAIN });
  assert.equal(await refusal(sendStarknet(transfer({ env: 'testnet' }), 1)), 'chain');
  assert.deepEqual(methods(onTest), ['starknet_chainId']);
  starknetNode();
  assert.equal(await refusal(sendStarknet(transfer({ network: 'eth' as never }), 1)), 'chain');
});

test('a recipient, an asset or a memo the transfer cannot carry is refused without asking the node', async () => {
  const calls = starknetNode();
  assert.equal(await refusal(sendStarknet(transfer({ to: '0x02fD23d9182193775423497fc0c472E156C57C69E4089A1967fb288A2d84e914' }), 1)), 'address');
  assert.equal(await refusal(sendStarknet(transfer({ to: '0x0' }), 1)), 'address');
  assert.equal(await refusal(sendStarknet(transfer({ asset: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8' }), 1)), 'address');
  assert.equal(await refusal(sendStarknet(transfer({ memo: '1234' }), 1)), 'memo');
  assert.equal(await refusal(sendStarknet(transfer({ amount: 0n }), 1)), 'minimum');
  assert.deepEqual(calls, []);
});

test('a registry token is paid from its contract, the fee from STRK', async () => {
  const usdc = '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8';
  const calls = starknetNode();
  await sendStarknet(transfer({ def: def([{ symbol: 'USDC', asset: usdc, decimals: 6 }]), asset: usdc, amount: 1_000_000n }), 1);
  const tx = broadcast(calls)[0].params.invoke_transaction as Record<string, unknown>;
  assert.equal((tx.calldata as string[])[1], hex(BigInt(usdc)));
});

test('an undeployed address with no STRK is unfunded; nothing is estimated or broadcast', async () => {
  const calls = starknetNode({ deployed: false, strk: 0n });
  assert.equal(await refusal(sendStarknet(transfer(), 1)), 'unfunded');
  assert.deepEqual(methods(calls), ['starknet_chainId', 'starknet_getClassHashAt', 'starknet_call']);
});

test('more than the balance, or not enough left for the fees (the deployment included), is funds', async () => {
  const short = starknetNode({ strk: 10n ** 18n - 1n });
  assert.equal(await refusal(sendStarknet(transfer(), 1)), 'funds');
  assert.ok(!methods(short).includes('starknet_estimateFee'));
  // the amount fits, the amount plus one transaction's cap does not
  const noFee = starknetNode({ strk: 10n ** 18n + ESTIMATE_CAP - 1n });
  assert.equal(await refusal(sendStarknet(transfer(), 1)), 'funds');
  assert.deepEqual(broadcast(noFee), []);
  const exact = starknetNode({ strk: 10n ** 18n + ESTIMATE_CAP });
  await sendStarknet(transfer(), 1);
  assert.equal(broadcast(exact).length, 1);
  // undeployed: the deployment's cap counts too
  const firstSend = starknetNode({ deployed: false, strk: 10n ** 18n + ESTIMATE_CAP });
  assert.equal(await refusal(sendStarknet(transfer(), 1)), 'funds');
  assert.deepEqual(broadcast(firstSend), []);
});

test('fees a node inflates past maxFee, or past the protocol fields, are refused, not paid', async () => {
  const capped = starknetNode();
  assert.equal(await refusal(sendStarknet(transfer({ maxFee: ESTIMATE_CAP - 1n }), 1)), 'fee');
  assert.deepEqual(broadcast(capped), []);
  // the deployment counts against the same cap
  const withDeploy = starknetNode({ deployed: false });
  assert.equal(await refusal(sendStarknet(transfer({ maxFee: 2n * ESTIMATE_CAP - 1n }), 1)), 'fee');
  assert.deepEqual(broadcast(withDeploy), []);
  const inflated = starknetNode({ estimate: { ...ESTIMATE, l2_gas_price: hex(10n ** 15n) } });
  assert.equal(await refusal(sendStarknet(transfer(), 1)), 'fee');
  assert.deepEqual(broadcast(inflated), []);
  const tooWide = starknetNode({ estimate: { ...ESTIMATE, l2_gas_consumed: hex(2n ** 64n - 1n), l2_gas_price: '0x1' } });
  assert.equal(await refusal(sendStarknet(transfer({ maxFee: 2n ** 80n }), 1)), 'fee');
  assert.deepEqual(broadcast(tooWide), []);
  const notFri = starknetNode({ estimate: { ...ESTIMATE, unit: 'WEI' } });
  assert.match(String(await refusal(sendStarknet(transfer(), 1))), /FRI/);
  assert.deepEqual(broadcast(notFri), []);
});

test('a key that does not own the account is an error before the node is asked', async () => {
  const calls = starknetNode();
  assert.match(String(await refusal(sendStarknet(transfer({ owner: '0x0123' }), 1))), /does not control/);
  assert.deepEqual(calls, []);
});

test('a node answering another transaction hash is an error, not a success', async () => {
  starknetNode({ answerHash: (h) => h + 1n });
  assert.match(String(await refusal(sendStarknet(transfer(), 1))), /another transaction hash/);
});

/* ---------------------------------- balance ----------------------------------- */

test('the STRK balance is read from the token as a u256', async () => {
  const calls = stubNode({ starknet_call: () => [hex(5n), hex(2n)] });
  assert.equal(await readStarknetBalance('mainnet', owner), 5n + 2n * 2n ** 128n);
  const request = calls[0].params.request as Record<string, unknown>;
  assert.equal(request.contract_address, hex(STRK_TOKEN));
  assert.equal(request.entry_point_selector, hex(STARKNET_BALANCE_OF_SELECTOR));
  assert.deepEqual(request.calldata, [owner]);
  stubNode({ starknet_call: () => ['0x5'] });
  await assert.rejects(readStarknetBalance('mainnet', owner));
  stubNode({ starknet_call: () => ({ error: { code: 21, message: 'Requested entrypoint does not exist' } }) });
  await assert.rejects(readStarknetBalance('testnet', owner));
});
