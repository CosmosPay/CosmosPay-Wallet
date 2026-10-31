/**
 * Paying TRX and Tron's USDT (src/lib/send/tron.ts). The protobuf the wallet builds is pinned to
 * the bytes Tron's own nodes produced: TronGrid's read-only builders (`createtransaction`,
 * `triggersmartcontract`) answered these raw_data_hex and txID for the same inputs, and Nile's node
 * took a transaction signed here past its reference-block, expiration and signature checks. Then,
 * against a stubbed node, every refusal — a node of another chain, a cost above the cap (prices a
 * node under-reports included), an asset or recipient the screen did not offer, a memo, an
 * account short of TRX, of USDT or never activated — and that none of those is broadcast.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { DEBUG_WALLET_PHRASE } from '@/constants/debug';
import { NETWORKS } from '@/constants/networks';
import { TRON_GENESIS_BLOCK_ID } from '@/constants/tronSend';
import { networkAddressesFromMnemonic } from '@/lib/chainAddresses';
import { networkSecret } from '@/lib/chainKeys';
import {
  encodeTronRaw,
  isTronAddress,
  sendTron,
  signTronRaw,
  trc20TransferData,
  tronAccountOfKey,
  tronAddressBytes,
  tronAddressOf,
} from '@/lib/send/tron';
import type { FamilyTransfer } from '@/lib/send/types';
import { networkDefOn } from '@/lib/testnets';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BIG = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G'; // an activated main-network account
const DEBUG = 'TZEyykBZFxNWuzGRNYchfpmjWsQpcVzgkQ'; // the debug wallet's (SEP-5's public phrase)
const USDT = NETWORKS.tron.tokens[0].asset;

/* ---------------------------- bytes Tron produced ---------------------------- */

test('addresses decode to the 21 bytes Tron nodes write for them', () => {
  // as TronGrid's builders wrote them in the raw_data_hex below
  assert.equal(bytesToHex(tronAddressBytes(BIG)!), '4189cbcb2372e1c2fbc00f24895a406a0c722c89f3');
  assert.equal(bytesToHex(tronAddressBytes(DEBUG)!), '41ff46ad7ad04f6a65a5411af3df8d3be918ff2b64');
  assert.equal(bytesToHex(tronAddressBytes(USDT)!), '41a614f803b6fd780986a42c78ec9c7f77e6ded13c');
  assert.equal(tronAddressOf(tronAddressBytes(DEBUG)!), DEBUG);
});

test('a TRX transfer encodes as TronGrid createtransaction built it (main network, 2026-10-29)', () => {
  const raw = encodeTronRaw({
    refBlockBytes: hexToBytes('c49b'),
    refBlockHash: hexToBytes('e5e50a05495bde1f'),
    expiration: 1793296146000n,
    timestamp: 1793296086464n,
    call: { type: 'transfer', owner: tronAddressBytes(BIG)!, to: tronAddressBytes(DEBUG)!, amount: 1000n },
  });
  assert.equal(
    bytesToHex(raw),
    '0a02c49b2208e5e50a05495bde1f40d0bc9ec698345a66080112620a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412310a154189cbcb2372e1c2fbc00f24895a406a0c722c89f3121541ff46ad7ad04f6a65a5411af3df8d3be918ff2b6418e80770c0eb9ac69834',
  );
  assert.equal(bytesToHex(sha256(raw)), 'ec064360146d8684c7fd515a623b0b3b42697264b71f44f6c22130f20f68ea56');
});

test('a USDT transfer with its fee_limit encodes as TronGrid triggersmartcontract built it (main network, 2026-10-29)', () => {
  const raw = encodeTronRaw({
    refBlockBytes: hexToBytes('c49a'),
    refBlockHash: hexToBytes('2c9fefeecf665c6a'),
    expiration: 1793296143000n,
    timestamp: 1793296086724n,
    feeLimit: 30_000_000n,
    call: { type: 'trigger', owner: tronAddressBytes(BIG)!, contract: tronAddressBytes(USDT)!, data: trc20TransferData(tronAddressBytes(DEBUG)!, 1_000_000n) },
  });
  assert.equal(
    bytesToHex(raw),
    '0a02c49a22082c9fefeecf665c6a4098a59ec698345aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a154189cbcb2372e1c2fbc00f24895a406a0c722c89f3121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb000000000000000000000000ff46ad7ad04f6a65a5411af3df8d3be918ff2b6400000000000000000000000000000000000000000000000000000000000f424070c4ed9ac6983490018087a70e',
  );
  assert.equal(bytesToHex(sha256(raw)), 'ebbdca923ed70cce9b383d17acde1c58df4af87c7467dfaabf731647a682b0a8');
});

test('the signature Nile verified is re-made byte for byte, r ‖ s ‖ 27 + recovery id', async () => {
  // Broadcast on Nile (the test network) on 2026-10-29: the node passed its reference block,
  // expiration and signature checks and refused only at bandwidth — the debug account was never
  // activated there ("account … does not exist"). RFC 6979 makes the signature deterministic.
  assert.equal((await networkAddressesFromMnemonic(DEBUG_WALLET_PHRASE)).tron, DEBUG);
  const secret = await networkSecret(DEBUG_WALLET_PHRASE, 'tron', DEBUG, 'testnet');
  try {
    assert.equal(tronAddressOf(tronAccountOfKey(secp256k1.getPublicKey(secret, true))), DEBUG);
    const raw = encodeTronRaw({
      refBlockBytes: hexToBytes('7feb'),
      refBlockHash: hexToBytes('525ce5799ef92848'),
      expiration: 1793296170000n,
      timestamp: 1793296112203n,
      call: { type: 'transfer', owner: tronAddressBytes(DEBUG)!, to: tronAddressBytes(BIG)!, amount: 1n },
    });
    const { txID, tx } = signTronRaw(raw, secret);
    assert.equal(txID, 'ed632f934aa60be36202c0f4723a42ffaa98ee40b88c1215ebda6f62ecec8f8b');
    const signature = tx.subarray(tx.length - 65);
    assert.equal(
      bytesToHex(signature),
      '8808579613c078e1406e0342c8bd084ebb627fc97ba5117f1575d395238dfb4502d3281e235455d631ea5e04ed1b0339346e4c575ee473337a6064733de170381b',
    );
    // the Transaction message: field 1 raw_data (its length a two-byte varint here), field 2 the signature
    assert.ok(raw.length >= 128 && raw.length < 16_384);
    const length = Uint8Array.of((raw.length & 0x7f) | 0x80, raw.length >> 7);
    assert.equal(bytesToHex(tx), bytesToHex(concatBytes(Uint8Array.of(0x0a), length, raw, Uint8Array.of(0x12, 0x41), signature)));
  } finally {
    secret.fill(0);
  }
});

test('a recipient is a T address with a valid checksum, on Tron only', () => {
  assert.ok(isTronAddress('tron', DEBUG, 'mainnet'));
  assert.ok(isTronAddress('tron', DEBUG, 'testnet'));
  assert.equal(isTronAddress('tron', 'TZEyykBZFxNWuzGRNYchfpmjWsQpcVzgkR', 'mainnet'), false); // checksum
  assert.equal(isTronAddress('tron', '41ff46ad7ad04f6a65a5411af3df8d3be918ff2b64', 'mainnet'), false); // hex form
  assert.equal(isTronAddress('tron', '0xff46ad7ad04f6a65a5411af3df8d3be918ff2b64', 'mainnet'), false);
  assert.equal(isTronAddress('tron', '1HZwkjkeaoZfTSaJxDw6aKkxp45agDiEzN', 'mainnet'), false); // base58check, not 0x41
  assert.equal(isTronAddress('eth', DEBUG, 'mainnet'), false);
});

/* -------------------------------- stubbed node ------------------------------- */

const secret = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const OWNER = tronAddressOf(tronAccountOfKey(secp256k1.getPublicKey(secret(), true)));
const HEAD = { number: 87_540_650, timestamp: 1_793_295_294_000, id: '000000000537c3aab33a4e0a283045dfdc25272800d5010bb858c545d0e37555' };

interface NodeState {
  genesis?: string;
  /** Requests answered 429 before the node answers at all (TronGrid's keyless rate limit). */
  limited?: number;
  accounts?: Record<string, number | null>;
  resources?: Record<string, number>;
  usdt?: bigint;
  energy?: number;
  energyFee?: number;
  broadcast?: Record<string, unknown>;
}

interface Calls {
  paths: string[];
  sent: string[];
}

/** TronGrid by path; records the paths asked and the transactions broadcast. */
function node(s: NodeState = {}): Calls {
  const calls: Calls = { paths: [], sent: [] };
  const accounts: Record<string, number | null> = { [OWNER]: 50_000_000, [DEBUG]: 1, ...s.accounts };
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    calls.paths.push(path);
    if ((s.limited ?? 0) > 0) {
      s.limited = (s.limited ?? 0) - 1;
      return new Response(JSON.stringify({ Error: 'request rate exceeded the allowed_rps(3)' }), { status: 429 });
    }
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    let answer: unknown;
    if (path === '/wallet/getblock') {
      answer =
        body.id_or_num === '0'
          ? { blockID: s.genesis ?? TRON_GENESIS_BLOCK_ID.mainnet }
          : { blockID: HEAD.id, block_header: { raw_data: { number: HEAD.number, timestamp: HEAD.timestamp } } };
    } else if (path === '/wallet/getchainparameters') {
      answer = {
        chainParameter: [
          { key: 'getTransactionFee', value: 1000 },
          { key: 'getEnergyFee', value: s.energyFee ?? 100 },
          { key: 'getCreateAccountFee', value: 100000 },
          { key: 'getCreateNewAccountFeeInSystemContract', value: 1000000 },
          { key: 'getCreateNewAccountBandwidthRate', value: 1 },
          { key: 'getMaxFeeLimit', value: 15000000000 },
          // flags the sender does not read, as both networks list them: negative, or without a value
          { key: 'getRemoveThePowerOfTheGr', value: -1 },
          { key: 'getAllowPBFT' },
        ],
      };
    } else if (path === '/wallet/getaccount') {
      const balance = accounts[String(body.address)];
      answer = balance === null || balance === undefined ? {} : { address: body.address, balance };
    } else if (path === '/wallet/getaccountresource') {
      answer = s.resources ?? { freeNetLimit: 600, freeNetUsed: 0 };
    } else if (path === '/wallet/triggerconstantcontract') {
      answer =
        body.function_selector === 'balanceOf(address)'
          ? { result: { result: true }, constant_result: [(s.usdt ?? 0n).toString(16).padStart(64, '0')], energy_used: 900 }
          : { result: { result: true }, constant_result: ['0'.repeat(64)], energy_used: s.energy ?? 65_000 };
    } else if (path === '/wallet/broadcasthex') {
      calls.sent.push(String(body.transaction));
      const raw = decodeTx(String(body.transaction)).raw;
      answer = s.broadcast ?? { result: true, txid: bytesToHex(sha256(raw)) };
    } else {
      throw new Error(`unexpected ${path}`);
    }
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as typeof fetch;
  return calls;
}

/** Split a broadcast `Transaction` into its raw data and signature (both lengths fit one varint byte or two). */
function decodeTx(txHex: string): { raw: Uint8Array; signature: Uint8Array } {
  const tx = hexToBytes(txHex);
  let i = 1;
  let len = 0;
  for (let shift = 0; ; shift += 7) {
    const b = tx[i++];
    len |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
  }
  const raw = tx.subarray(i, i + len);
  assert.equal(bytesToHex(tx.subarray(i + len, i + len + 2)), '1241');
  return { raw, signature: tx.subarray(i + len + 2) };
}

/** fee_limit: field 18, the last one of `Transaction.raw` — its key is the two-byte varint 0x90 0x01. */
function feeLimitOf(raw: Uint8Array): bigint {
  for (let start = raw.length - 3; start >= 0; start--) {
    if (raw[start] !== 0x90 || raw[start + 1] !== 0x01) continue;
    let v = 0n;
    let i = start + 2;
    for (let shift = 0n; i < raw.length; shift += 7n) {
      const b = raw[i++];
      v |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) break;
    }
    if (i === raw.length) return v;
  }
  throw new Error('no fee_limit');
}

/** No pacing in a test: the stub has no rate to keep. */
const send = (p: FamilyTransfer) => sendTron(p, { gapMs: 0, retryMs: 0 });

const transfer = (over: Partial<FamilyTransfer> = {}): FamilyTransfer => ({
  network: 'tron',
  env: 'mainnet',
  def: networkDefOn('tron', over.env ?? 'mainnet')!,
  secret: secret(),
  owner: OWNER,
  asset: 'native',
  to: DEBUG,
  amount: 10_000_000n,
  maxFee: 30_000_000n,
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

test('a TRX transfer is built on the head block, signed by the owner and broadcast', async () => {
  const calls = node();
  const id = await send(transfer());
  assert.equal(calls.sent.length, 1);
  const { raw, signature } = decodeTx(calls.sent[0]);
  assert.equal(id, bytesToHex(sha256(raw)));
  // the reference block: bytes 6–7 of the head's number, bytes 8–15 of its id
  assert.equal(bytesToHex(raw.subarray(0, 14)), `0a02c3aa2208${HEAD.id.slice(16, 32)}`);
  // the contract pays exactly the amount to the recipient
  const value = bytesToHex(concatBytes(Uint8Array.of(0x0a, 0x15), tronAddressBytes(OWNER)!, Uint8Array.of(0x12, 0x15), tronAddressBytes(DEBUG)!));
  assert.ok(bytesToHex(raw).includes(`${value}18${'80ade204'}`)); // amount 10 000 000 as a varint
  // the signature recovers to the owner
  const sig = secp256k1.Signature.fromBytes(signature.subarray(0, 64), 'compact').addRecoveryBit(signature[64] - 27);
  const pub = sig.recoverPublicKey(sha256(raw)).toBytes(true);
  assert.equal(tronAddressOf(tronAccountOfKey(pub)), OWNER);
});

test('a node of another chain is refused before anything is signed', async () => {
  const nile = node({ genesis: TRON_GENESIS_BLOCK_ID.testnet });
  assert.equal(await refusal(send(transfer())), 'chain');
  assert.deepEqual(nile.paths, ['/wallet/getblock']);
  // in test mode the main network's node is the wrong one, and Nile's the right one
  const main = node();
  assert.equal(await refusal(send(transfer({ env: 'testnet' }))), 'chain');
  assert.equal(main.sent.length, 0);
  const test = node({ genesis: TRON_GENESIS_BLOCK_ID.testnet });
  assert.match(await send(transfer({ env: 'testnet' })), /^[0-9a-f]{64}$/);
  assert.equal(test.sent.length, 1);
});

test('only TRX or the registry USDT; a test network carries its coin only', async () => {
  const calls = node({ usdt: 10n ** 12n });
  assert.equal(await refusal(send(transfer({ asset: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj' }))), 'address');
  assert.equal(await refusal(send(transfer({ asset: USDT, env: 'testnet' }))), 'address');
  assert.equal(calls.paths.length, 0);
});

test('a recipient that is not a Tron address, or is ourselves, and any memo are refused', async () => {
  const calls = node();
  assert.equal(await refusal(send(transfer({ to: 'TZEyykBZFxNWuzGRNYchfpmjWsQpcVzgkR' }))), 'address');
  assert.equal(await refusal(send(transfer({ to: '0x000000000000000000000000000000000000dEaD' }))), 'address');
  assert.equal(await refusal(send(transfer({ to: OWNER }))), 'address');
  assert.equal(await refusal(send(transfer({ memo: 'invoice 7' }))), 'memo');
  assert.equal(calls.paths.length, 0);
});

test('an account never activated cannot pay', async () => {
  const calls = node({ accounts: { [OWNER]: null } });
  assert.equal(await refusal(send(transfer())), 'unfunded');
  assert.equal(calls.sent.length, 0);
});

test('TRX must cover the amount and the bandwidth the account no longer has for free', async () => {
  // free bandwidth left: the whole balance can go
  const free = node({ accounts: { [OWNER]: 10_000_000 } });
  await send(transfer());
  assert.equal(free.sent.length, 1);
  // none left: ~270 bytes × 1000 sun burn on top of the amount
  const spent = node({ accounts: { [OWNER]: 10_000_000 }, resources: { freeNetLimit: 600, freeNetUsed: 600 } });
  assert.equal(await refusal(send(transfer())), 'funds');
  assert.equal(spent.sent.length, 0);
});

test('activating a new recipient costs 1 TRX plus 0.1 TRX without staked bandwidth; above the cap it is refused', async () => {
  const fresh = { [DEBUG]: null };
  const short = node({ accounts: { ...fresh, [OWNER]: 11_000_000 } });
  assert.equal(await refusal(send(transfer())), 'funds');
  assert.equal(short.sent.length, 0);
  const enough = node({ accounts: { ...fresh, [OWNER]: 11_100_000 } });
  await send(transfer());
  assert.equal(enough.sent.length, 1);
  // staked bandwidth pays the creation: only the system contract's 1 TRX
  const staked = node({ accounts: { ...fresh, [OWNER]: 11_000_000 }, resources: { NetLimit: 5000, NetUsed: 0 } });
  await send(transfer());
  assert.equal(staked.sent.length, 1);
  const capped = node({ accounts: fresh });
  assert.equal(await refusal(send(transfer({ maxFee: 1_099_999n }))), 'fee');
  assert.equal(capped.sent.length, 0);
});

test('a USDT transfer is capped by fee_limit: what maxFee leaves after the worst-case bandwidth', async () => {
  const calls = node({ usdt: 5_000_000n, energy: 65_000 });
  const id = await send(transfer({ asset: USDT, amount: 5_000_000n }));
  const { raw } = decodeTx(calls.sent[0]);
  assert.equal(id, bytesToHex(sha256(raw)));
  assert.ok(bytesToHex(raw).includes(bytesToHex(trc20TransferData(tronAddressBytes(DEBUG)!, 5_000_000n))));
  const feeLimit = feeLimitOf(raw);
  const bytes = BigInt(raw.length + 3 + 67 + 64); // field key + 2-byte length, signature field, result
  assert.equal(feeLimit, 30_000_000n - bytes * 1000n);
});

test('USDT short of the amount, or TRX short of the energy, is refused', async () => {
  const noUsdt = node({ usdt: 4_999_999n });
  assert.equal(await refusal(send(transfer({ asset: USDT, amount: 5_000_000n }))), 'funds');
  assert.equal(noUsdt.sent.length, 0);
  // the transfer is not even estimated
  assert.equal(noUsdt.paths.filter((p) => p === '/wallet/triggerconstantcontract').length, 1);
  // 65 000 energy × 1.2 × 100 sun = 7.8 TRX to burn, the account holds 7 TRX
  const noTrx = node({ usdt: 5_000_000n, energy: 65_000, accounts: { [OWNER]: 7_000_000 } });
  assert.equal(await refusal(send(transfer({ asset: USDT, amount: 5_000_000n }))), 'funds');
  assert.equal(noTrx.sent.length, 0);
  // staked energy covers it
  const staked = node({ usdt: 5_000_000n, energy: 65_000, accounts: { [OWNER]: 7_000_000 }, resources: { EnergyLimit: 100_000, freeNetLimit: 600 } });
  await send(transfer({ asset: USDT, amount: 5_000_000n }));
  assert.equal(staked.sent.length, 1);
});

test('energy that would not fit under the cap is refused, even when a node under-reports its price', async () => {
  // 130 000 energy × 1.2 × 100 sun = 15.6 TRX, the cap 10 TRX
  const costly = node({ usdt: 5_000_000n, energy: 130_000 });
  assert.equal(await refusal(send(transfer({ asset: USDT, amount: 5_000_000n, maxFee: 10_000_000n }))), 'fee');
  assert.equal(costly.sent.length, 0);
  // a node claiming 1 sun per energy is not believed below the floor
  const lying = node({ usdt: 5_000_000n, energy: 130_000, energyFee: 1 });
  assert.equal(await refusal(send(transfer({ asset: USDT, amount: 5_000_000n, maxFee: 10_000_000n }))), 'fee');
  assert.equal(lying.sent.length, 0);
});

test('a broadcast the node refuses is an error naming its code', async () => {
  node({ broadcast: { result: false, code: 'BANDWITH_ERROR', message: 'account … bandwidth' } });
  assert.match(String(await refusal(send(transfer()))), /BANDWITH_ERROR/);
});

test('a 429 from the keyless gateway is waited out and asked again, twice at most', async () => {
  const twice = node({ limited: 2 });
  assert.match(await send(transfer()), /^[0-9a-f]{64}$/);
  assert.equal(twice.sent.length, 1);
  const thrice = node({ limited: 3 });
  assert.match(String(await refusal(send(transfer()))), /HTTP 429/);
  assert.equal(thrice.sent.length, 0);
});

test('requests are spaced by the pace, so a send stays under the keyless rate', async () => {
  const calls = node();
  const started: number[] = [];
  const stub = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    started.push(Date.now());
    return stub(url, init);
  }) as typeof fetch;
  await sendTron(transfer(), { gapMs: 40, retryMs: 0 });
  assert.equal(calls.sent.length, 1);
  // the i-th request starts i gaps after the first (timers may run a few ms late, never early)
  for (let i = 1; i < started.length; i++) assert.ok(started[i] - started[0] >= i * 40 - 5, `request ${i} came ${started[i] - started[0]} ms after the first`);
});

test('a key that does not control the owner never signs', async () => {
  const calls = node();
  assert.match(String(await refusal(send(transfer({ owner: BIG })))), /does not control/);
  assert.equal(calls.paths.length, 0);
});
