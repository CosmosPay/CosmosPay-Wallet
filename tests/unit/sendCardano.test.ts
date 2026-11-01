/**
 * Paying ADA (src/lib/send/cardano.ts), against published vectors and a stubbed pair of services.
 *
 * What is pinned:
 *  - The key: the payment key derived here is the one inside the address the wallet already
 *    shows (`lib/addresses/cardano.ts`) — for the debug phrase, and for "abandon … about", whose
 *    address is Trust Wallet Core's own (`tests/unit/chainAddresses.test.ts`).
 *  - The signature: extended-key signing is RFC 8032's for a key expanded from a seed (RFC 8032
 *    §7.1 TEST 1), and every signature verifies with `ed25519.verify`.
 *  - The bytes: CBOR heads against RFC 8949 Appendix A, a transaction body byte for byte, the
 *    signed transaction taken apart again.
 *  - The money: the fee is min_fee_a × size + min_fee_b of the very transaction it is in, the
 *    recipient's output meets the minimum UTxO, change below it goes to the fee, value balances.
 *  - Addresses: CIP-19's test vectors, Byron's CRC and protocol magic, the network of each mode.
 *  - Refusals: every code, and nothing submitted when refused — nothing even asked of a service
 *    when the refusal needs no answer from one.
 *
 * `CARDANO_LIVE=1` adds read-only calls to the real services (identity, balances, a mainnet dry
 * run that never submits, and Preprod's Ogmios decoding a signed transfer).
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { mnemonicToEntropy } from 'bip39';
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base58, bech32 } from '@scure/base';
import { DEBUG_WALLET_PHRASE } from '@/constants/debug';
import { NETWORKS } from '@/constants/networks';
import type { ChainNet } from '@/constants/chains';
import { CARDANO_ENDPOINTS, CARDANO_REFERENCE_BLOCK, CARDANO_TTL_SLOTS } from '@/constants/cardanoSend';
import { cardanoBaseAddress } from '@/lib/addresses/cardano';
import {
  assertCardanoNetwork,
  cardanoBody,
  cardanoKeyControls,
  cardanoMinFee,
  cardanoMinUtxo,
  cardanoOutput,
  cardanoPaymentSecret,
  cardanoPublicKey,
  cardanoSign,
  cardanoSignedTx,
  cardanoTestnetAddress,
  isCardanoAddress,
  planCardanoTransfer,
  prepareCardanoTransfer,
  readCardanoBalance,
  sendCardano,
  type CardanoParams,
  type CardanoUtxo,
} from '@/lib/send/cardano';
import { cborArray, cborBytes, cborDecode, cborMap, cborTag, cborUint, type CborItem } from '@/lib/send/cbor';
import type { FamilyTransfer } from '@/lib/send/types';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const entropyOf = (phrase: string) => hexToBytes(mnemonicToEntropy(phrase));
const DEBUG_ENTROPY = entropyOf(DEBUG_WALLET_PHRASE);
const DEBUG_ADDRESS = cardanoBaseAddress(DEBUG_ENTROPY);
const DEBUG_TEST_ADDRESS = cardanoTestnetAddress(DEBUG_ADDRESS)!;
const ABOUT = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
/** Trust Wallet Core's address for ABOUT (pinned in chainAddresses.test.ts). */
const ABOUT_ADDRESS = 'addr1qy8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mq4afdhv';

/** CIP-19's test vectors, one per header type. */
const CIP19 = {
  base: 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
  baseScriptPayment: 'addr1z8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs9yc0hh',
  baseScriptStake: 'addr1yx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerkr0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shs2z78ve',
  baseScriptBoth: 'addr1x8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gt7r0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shskhj42g',
  pointer: 'addr1gx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrzqf96k',
  pointerScript: 'addr128phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtupnz75xxcrtw79hu',
  enterprise: 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8',
  enterpriseScript: 'addr1w8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcyjy7wx',
  reward: 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw',
  rewardScript: 'stake178phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcccycj5',
  testBase: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae',
  testEnterprise: 'addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz',
  /** Byron, on the retired legacy test network (protocol magic 1097911063). */
  byronLegacyTest: '37btjrVyb4KDXBNC4haBVPCrro8AQPHwvCMp3RFhhSVWwfFmZ6wwzSK6JK1hY6wHNmtrpTf1kdbva8TCneM2YsiXT7mrzT21EacHnPpz5YyUdj64na',
} as const;
/** A mainnet Byron (Icarus-style) address: no attributes. */
const BYRON_MAINNET = 'Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi';

const bytesOf = (address: string) => bech32.decodeToBytes(address, false).bytes;
const keyHashOf = (address: string) => bytesOf(address).slice(1, 29);

/** Mainnet's parameters on 2026-10-29 (epoch 664), in Ogmios' shape and in the module's. */
const PARAMS: CardanoParams = { minFeeA: 44n, minFeeB: 155_381n, coinsPerUtxoByte: 4_310n, maxTxSize: 16_384 };
const OGMIOS_PARAMS = {
  minFeeCoefficient: 44,
  minFeeConstant: { ada: { lovelace: 155_381 } },
  minUtxoDepositCoefficient: 4_310,
  minUtxoDepositConstant: { ada: { lovelace: 0 } },
  maxTransactionSize: { bytes: 16_384 },
};

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};
const refusalSync = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};

/* ------------------------------------ keys ------------------------------------ */

test('the payment key is the one inside the address the wallet shows for the debug phrase', () => {
  const secret = cardanoPaymentSecret(DEBUG_ENTROPY);
  assert.equal(secret.length, 64);
  assert.deepEqual(blake2b(cardanoPublicKey(secret), { dkLen: 28 }), keyHashOf(DEBUG_ADDRESS));
  assert.ok(cardanoKeyControls(secret, DEBUG_ADDRESS, 'mainnet'));
  assert.ok(cardanoKeyControls(secret, DEBUG_TEST_ADDRESS, 'testnet'));
  // An address of the other mode is not one this mode pays from.
  assert.ok(!cardanoKeyControls(secret, DEBUG_ADDRESS, 'testnet'));
});

test("the payment key matches Trust Wallet Core's CIP-1852 address for \"abandon … about\"", () => {
  const secret = cardanoPaymentSecret(entropyOf(ABOUT));
  assert.equal(cardanoBaseAddress(entropyOf(ABOUT)), ABOUT_ADDRESS);
  assert.deepEqual(blake2b(cardanoPublicKey(secret), { dkLen: 28 }), keyHashOf(ABOUT_ADDRESS));
  assert.ok(!cardanoKeyControls(secret, DEBUG_ADDRESS, 'mainnet'));
});

/* --------------------------------- signatures --------------------------------- */

/** RFC 8032's key expansion: the clamped scalar kL and the nonce prefix kR of an ed25519 seed. */
function expand(seed: Uint8Array): Uint8Array {
  const h = sha512(seed);
  h[0] &= 0xf8;
  h[31] &= 0x7f;
  h[31] |= 0x40;
  return h;
}

test('extended-key signing is RFC 8032 for a key expanded from a seed (§7.1 TEST 1)', () => {
  const extended = expand(hexToBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'));
  assert.equal(bytesToHex(cardanoPublicKey(extended)), 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  assert.equal(
    bytesToHex(cardanoSign(extended, new Uint8Array(0))),
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  );
});

test('extended-key signing equals noble’s ed25519 for random seeds and 32-byte messages', () => {
  for (let i = 0; i < 8; i++) {
    const seed = Uint8Array.from({ length: 32 }, (_, j) => (i * 37 + j * 11) & 0xff);
    const message = blake2b(Uint8Array.of(i), { dkLen: 32 });
    assert.equal(bytesToHex(cardanoSign(expand(seed), message)), bytesToHex(ed25519.sign(message, seed)));
  }
});

test('a derived payment key’s signature verifies, and only over its own message', () => {
  const secret = cardanoPaymentSecret(DEBUG_ENTROPY);
  const message = blake2b(new TextEncoder().encode('body'), { dkLen: 32 });
  const signature = cardanoSign(secret, message);
  assert.ok(ed25519.verify(signature, message, cardanoPublicKey(secret)));
  const other = Uint8Array.from(message);
  other[0] ^= 1;
  assert.ok(!ed25519.verify(signature, other, cardanoPublicKey(secret)));
});

/* ------------------------------------ CBOR ------------------------------------ */

test('CBOR heads take their shortest form (RFC 8949 Appendix A)', () => {
  const hex = (b: Uint8Array) => bytesToHex(b);
  assert.equal(hex(cborUint(0)), '00');
  assert.equal(hex(cborUint(23)), '17');
  assert.equal(hex(cborUint(24)), '1818');
  assert.equal(hex(cborUint(100)), '1864');
  assert.equal(hex(cborUint(1000)), '1903e8');
  assert.equal(hex(cborUint(1_000_000)), '1a000f4240');
  assert.equal(hex(cborUint(1_000_000_000_000n)), '1b000000e8d4a51000');
  assert.equal(hex(cborUint(18_446_744_073_709_551_615n)), '1bffffffffffffffff');
  assert.throws(() => cborUint(18_446_744_073_709_551_616n));
  assert.throws(() => cborUint(-1n));
  assert.equal(hex(cborBytes(hexToBytes('01020304'))), '4401020304');
  assert.equal(hex(cborArray([cborUint(1), cborUint(2), cborUint(3)])), '83010203');
  assert.equal(hex(cborMap([[cborUint(1), cborUint(2)], [cborUint(3), cborUint(4)]])), 'a201020304');
  assert.equal(hex(cborTag(1, cborUint(1_363_896_240))), 'c11a514b67b0');
});

test('CBOR decoding is strict: one definite item, nothing after it', () => {
  assert.deepEqual(cborDecode(hexToBytes('83010203')), {
    type: 'array',
    items: [1n, 2n, 3n].map((value) => ({ type: 'uint', value })),
  });
  assert.throws(() => cborDecode(hexToBytes('0101')), /trailing/);
  assert.throws(() => cborDecode(hexToBytes('9f0102ff')), /unsupported/);
  assert.throws(() => cborDecode(hexToBytes('5a00000010aa')), /truncated/);
  assert.throws(() => cborDecode(hexToBytes('fa47c35000')), /unsupported/);
  assert.throws(() => cborDecode(hexToBytes('81'.repeat(40) + '00')), /deep/);
});

const UTXO_A: CardanoUtxo = { txHash: '11'.repeat(32), index: 0, lovelace: 5_000_000n };

test('a transaction body is these bytes, keys ascending, inputs tagged as a set', () => {
  const to = bytesOf(CIP19.enterprise);
  const body = cardanoBody([UTXO_A], [cardanoOutput(to, 1_000_000n)], 170_000n, 1_000n, 1);
  const expected =
    'a5' + // map(5)
    '00' + 'd90102' + '81' + '82' + '5820' + '11'.repeat(32) + '00' + // 0: #6.258([[id, 0]])
    '01' + '81' + '82' + '581d' + bytesToHex(to) + '1a000f4240' + // 1: [[address, 1 ADA]]
    '02' + '1a00029810' + // 2: fee 170 000
    '03' + '1903e8' + // 3: ttl 1 000
    '0f' + '01'; // 15: network id 1
  assert.equal(bytesToHex(body), expected);
});

test('inputs are written in the ledger’s order whatever order they come in', () => {
  const a: CardanoUtxo = { txHash: 'aa'.repeat(32), index: 1, lovelace: 1n };
  const b: CardanoUtxo = { txHash: 'aa'.repeat(32), index: 0, lovelace: 1n };
  const c: CardanoUtxo = { txHash: '0a'.repeat(32), index: 9, lovelace: 1n };
  const out = [cardanoOutput(bytesOf(CIP19.enterprise), 1n)];
  assert.deepEqual(cardanoBody([a, b, c], out, 1n, 1n, 1), cardanoBody([c, b, a], out, 1n, 1n, 1));
});

/** The signed transaction taken apart: [body, {0: #6.258([[vkey, sig]])}, true, null]. */
function takeApart(tx: Uint8Array) {
  const top = cborDecode(tx);
  assert.equal(top.type, 'array');
  const [bodyItem, witnesses, valid, aux] = (top as { items: CborItem[] }).items;
  assert.deepEqual(valid, { type: 'simple', value: 21 });
  assert.deepEqual(aux, { type: 'simple', value: 22 });
  assert.equal(witnesses.type, 'map');
  const [[key, set]] = (witnesses as { entries: [CborItem, CborItem][] }).entries;
  assert.deepEqual(key, { type: 'uint', value: 0n });
  assert.ok(set.type === 'tag' && set.tag === 258n && set.item.type === 'array');
  const [pair] = (set.item as { items: CborItem[] }).items;
  const [vkey, signature] = (pair as { items: { value: Uint8Array }[] }).items;
  // One witness of fixed widths: the body is everything between the array head and these 107 bytes.
  const body = tx.slice(1, tx.length - 2 - 107);
  assert.deepEqual(cborDecode(body), bodyItem);
  const fields = new Map((bodyItem as { entries: [CborItem, CborItem][] }).entries.map(([k, v]) => [Number((k as { value: bigint }).value), v]));
  return { body, fields, vkey: vkey.value, signature: signature.value };
}

/** The outputs of a decoded body as [address hex, lovelace]. */
function outputsOf(fields: Map<number, CborItem>): [string, bigint][] {
  const list = fields.get(1) as unknown as { items: { items: [{ value: Uint8Array }, { value: bigint }] }[] };
  return list.items.map(({ items: [address, coin] }) => [bytesToHex(address.value), coin.value]);
}

/* ------------------------------ fee and minimum UTxO ------------------------------ */

test('the minimum UTxO is coins per byte × (160 + the output’s size)', () => {
  // A base address output: array head 1 + bytes head 2 + 57 + a 5-byte coin = 65 bytes.
  const base = cardanoOutput(bytesOf(CIP19.base), 1_000_000n);
  assert.equal(base.length, 65);
  assert.equal(cardanoMinUtxo(base, 4_310n), 969_750n);
  const enterprise = cardanoOutput(bytesOf(CIP19.enterprise), 1_000_000n);
  assert.equal(enterprise.length, 37);
  assert.equal(cardanoMinUtxo(enterprise, 4_310n), 849_070n);
  // Past 2^32 lovelace the coin takes 9 bytes, and the minimum grows with it.
  assert.equal(cardanoMinUtxo(cardanoOutput(bytesOf(CIP19.base), 5_000_000_000n), 4_310n), 986_990n);
  assert.equal(cardanoMinFee(300, PARAMS), 44n * 300n + 155_381n);
});

const planFor = (utxos: CardanoUtxo[], amount: bigint, to: string = CIP19.base, params = PARAMS) =>
  planCardanoTransfer({ utxos, params, to: bytesOf(to), changeTo: bytesOf(DEBUG_ADDRESS), amount, ttl: 200_007_200n, networkId: 1 });

test('the fee is the protocol’s price of the very transaction it is in, and value balances', () => {
  const plan = planFor([UTXO_A], 2_000_000n);
  const secret = cardanoPaymentSecret(DEBUG_ENTROPY);
  const tx = cardanoSignedTx(plan.body, cardanoPublicKey(secret), cardanoSign(secret, plan.bodyHash));
  assert.equal(tx.length, plan.size);
  assert.ok(plan.fee >= cardanoMinFee(tx.length, PARAMS));
  // Settled within a few bytes' worth (a width that moved between rounds), never under.
  assert.ok(plan.fee - cardanoMinFee(tx.length, PARAMS) < 44n * 8n);
  assert.equal(plan.fee + plan.change + 2_000_000n, UTXO_A.lovelace);
  const { fields } = takeApart(tx);
  assert.deepEqual(outputsOf(fields), [
    [bytesToHex(bytesOf(CIP19.base)), 2_000_000n],
    [bytesToHex(bytesOf(DEBUG_ADDRESS)), plan.change],
  ]);
  assert.equal(bytesToHex(blake2b(plan.body, { dkLen: 32 })), plan.txId);
});

test('change below the minimum UTxO goes to the fee when there is no other input to take', () => {
  // 3 ADA − 2.5 ADA leaves ~0.33 ADA after the fee: less than an output must hold.
  const plan = planFor([{ txHash: '33'.repeat(32), index: 0, lovelace: 3_000_000n }], 2_500_000n);
  assert.equal(plan.change, 0n);
  assert.equal(plan.fee, 500_000n);
  const { fields } = takeApart(cardanoSignedTx(plan.body, new Uint8Array(32), new Uint8Array(64)));
  assert.equal(outputsOf(fields).length, 1);
});

test('one more input is taken rather than burning a too-small change', () => {
  const plan = planFor(
    [
      { txHash: '33'.repeat(32), index: 0, lovelace: 3_000_000n },
      { txHash: '44'.repeat(32), index: 0, lovelace: 2_000_000n },
    ],
    2_500_000n,
  );
  assert.equal(plan.inputs.length, 2);
  assert.ok(plan.change >= 969_750n);
  assert.equal(plan.fee + plan.change + 2_500_000n, 5_000_000n);
});

test('the largest UTXOs are spent first', () => {
  const small = { txHash: '55'.repeat(32), index: 0, lovelace: 1_500_000n };
  const big = { txHash: '66'.repeat(32), index: 3, lovelace: 9_000_000n };
  const plan = planFor([small, big], 2_000_000n);
  assert.deepEqual(plan.inputs, [big]);
});

test('the recipient’s output must hold the minimum UTxO: refused "minimum" one lovelace short', () => {
  assert.equal(refusalSync(() => planFor([UTXO_A], 969_749n)), 'minimum');
  assert.equal(planFor([UTXO_A], 969_750n).inputs.length, 1);
  assert.equal(refusalSync(() => planFor([UTXO_A], 849_069n, CIP19.enterprise)), 'minimum');
  assert.equal(refusalSync(() => planFor([UTXO_A], 0n)), 'minimum');
});

test('UTXOs that cannot pay the amount and the fee are refused "funds"', () => {
  assert.equal(refusalSync(() => planFor([{ txHash: '77'.repeat(32), index: 0, lovelace: 2_100_000n }], 2_000_000n)), 'funds');
  assert.equal(refusalSync(() => planFor([], 2_000_000n)), 'funds');
  // Enough lovelace, but only spread over more inputs than one transaction can carry.
  const dust = Array.from({ length: 12 }, (_, i): CardanoUtxo => ({ txHash: i.toString(16).padStart(64, '0'), index: 0, lovelace: 1_000_000n }));
  assert.equal(refusalSync(() => planFor(dust, 8_000_000n, CIP19.base, { ...PARAMS, maxTxSize: 400 })), 'funds');
  // Nine inputs would pay it, but leave ~0.82 ADA: under an output's minimum, so a tenth is taken.
  assert.equal(planFor(dust, 8_000_000n).inputs.length, 10);
});

/* ---------------------------------- addresses ---------------------------------- */

test('payment recipients: key base and enterprise addresses of the mode’s network (CIP-19 vectors)', () => {
  const on = (address: string, env: ChainNet) => isCardanoAddress('cardano', address, env);
  for (const ok of [CIP19.base, CIP19.baseScriptStake, CIP19.enterprise, BYRON_MAINNET]) {
    assert.ok(on(ok, 'mainnet'), ok);
    assert.ok(!on(ok, 'testnet'), ok);
  }
  for (const ok of [CIP19.testBase, CIP19.testEnterprise]) {
    assert.ok(on(ok, 'testnet'), ok);
    assert.ok(!on(ok, 'mainnet'), ok);
  }
  // Script payment parts, pointers and reward addresses are no recipient of a plain transfer.
  for (const no of [CIP19.baseScriptPayment, CIP19.baseScriptBoth, CIP19.pointer, CIP19.pointerScript, CIP19.enterpriseScript, CIP19.reward, CIP19.rewardScript]) {
    assert.ok(!on(no, 'mainnet'), no);
    assert.ok(!on(no, 'testnet'), no);
  }
  assert.ok(!isCardanoAddress('btc', CIP19.base, 'mainnet'));
  for (const junk of ['', 'addr1', CIP19.base.slice(0, -1) + 'q', CIP19.base.toUpperCase().slice(0, 10), 'x'.repeat(500)]) {
    assert.ok(!on(junk, 'mainnet'), junk);
  }
});

test('a mainnet header under the test prefix (or the reverse) is not an address of either', () => {
  const wrongNet = (prefix: string, bytes: Uint8Array) => bech32.encode(prefix, bech32.toWords(bytes), false);
  assert.ok(!isCardanoAddress('cardano', wrongNet('addr_test', bytesOf(CIP19.base)), 'testnet'));
  assert.ok(!isCardanoAddress('cardano', wrongNet('addr', bytesOf(CIP19.testBase)), 'mainnet'));
});

/** A Byron address with `attributes`, its CRC computed by zlib's independent CRC-32. */
function byron(attributes: [Uint8Array, Uint8Array][], crcDelta = 0): string {
  const payload = cborArray([cborBytes(new Uint8Array(28).fill(7)), cborMap(attributes), cborUint(0)]);
  return base58.encode(cborArray([cborTag(24, cborBytes(payload)), cborUint((crc32(payload) + crcDelta) >>> 0)]));
}

test('Byron addresses: CRC-checked, public-key type, the mode’s protocol magic', () => {
  const on = (address: string, env: ChainNet) => isCardanoAddress('cardano', address, env);
  const preprod = byron([[cborUint(2), cborBytes(cborUint(1))]]);
  assert.ok(on(preprod, 'testnet'));
  assert.ok(!on(preprod, 'mainnet'));
  assert.ok(on(byron([]), 'mainnet'));
  assert.ok(on(byron([[cborUint(1), cborBytes(new Uint8Array(30))]]), 'mainnet'));
  assert.ok(!on(byron([], 1), 'mainnet'), 'a bad CRC');
  assert.ok(!on(byron([[cborUint(2), cborBytes(cborUint(764_824_073))]]), 'mainnet'), 'mainnet leaves the magic out');
  assert.ok(!on(byron([[cborUint(3), cborBytes(new Uint8Array(1))]]), 'mainnet'), 'an attribute Byron does not define');
  assert.ok(!on(CIP19.byronLegacyTest, 'mainnet'));
  assert.ok(!on(CIP19.byronLegacyTest, 'testnet'));
  // One character changed: base58 still decodes, the CRC does not hold.
  assert.ok(!on(BYRON_MAINNET.slice(0, -2) + (BYRON_MAINNET.endsWith('i') ? 'j' : 'i') + BYRON_MAINNET.slice(-1), 'mainnet'));
});

test('the test networks’ address is the same keys under network id 0', () => {
  assert.equal(cardanoTestnetAddress(CIP19.base), CIP19.testBase);
  assert.equal(cardanoTestnetAddress(CIP19.enterprise), CIP19.testEnterprise);
  assert.equal(cardanoTestnetAddress(CIP19.testBase), null);
  assert.equal(cardanoTestnetAddress(BYRON_MAINNET), null);
  assert.ok(DEBUG_TEST_ADDRESS.startsWith('addr_test1'));
  assert.deepEqual(keyHashOf(DEBUG_TEST_ADDRESS), keyHashOf(DEBUG_ADDRESS));
});

/* -------------------------------- the services -------------------------------- */

interface Chain {
  magic?: number;
  holds?: boolean;
  slot?: number;
  params?: Record<string, unknown>;
  utxos?: Record<string, unknown>[];
  sum?: unknown;
  /** What submitTransaction answers for the submitted cbor: `{ result }` or `{ error }`. */
  submit?: (tx: Uint8Array) => Record<string, unknown>;
  status?: number;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Stub both services of `env`; any other URL — the other mode's included — fails the test. */
function services(env: ChainNet, chain: Chain = {}) {
  const calls: string[] = [];
  const submitted: Uint8Array[] = [];
  const { ogmios, yoroi } = CARDANO_ENDPOINTS[env];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as { method?: string; params?: { transaction?: { cbor: string } }; reference?: { bestBlocks: string[] } };
    if (init.credentials !== 'omit') throw new Error('a request carried credentials');
    if (url === ogmios) {
      calls.push(body.method!);
      switch (body.method) {
        case 'queryNetwork/genesisConfiguration':
          return json({ jsonrpc: '2.0', result: { era: 'shelley', networkMagic: chain.magic ?? (env === 'mainnet' ? 764_824_073 : 1) } });
        case 'queryNetwork/tip':
          return json({ jsonrpc: '2.0', result: { slot: chain.slot ?? 200_000_000, id: 'ab'.repeat(32) } });
        case 'queryLedgerState/protocolParameters':
          return json({ jsonrpc: '2.0', result: chain.params ?? OGMIOS_PARAMS });
        case 'submitTransaction': {
          const tx = hexToBytes(body.params!.transaction!.cbor);
          submitted.push(tx);
          const answer = chain.submit?.(tx) ?? { result: { transaction: { id: bytesToHex(blake2b(takeApart(tx).body, { dkLen: 32 })) } } };
          return json({ jsonrpc: '2.0', ...answer }, 'error' in answer ? 400 : 200);
        }
      }
      throw new Error(`unexpected ogmios ${body.method}`);
    }
    if (url === `${yoroi}/v2/tipStatus`) {
      calls.push('tipStatus');
      assert.deepEqual(body.reference?.bestBlocks, [CARDANO_REFERENCE_BLOCK[env]]);
      return chain.holds === false
        ? json({ error: { response: 'REFERENCE_POINT_BLOCK_NOT_FOUND' } }, 500)
        : json({ bestBlock: {}, reference: { lastFoundSafeBlock: CARDANO_REFERENCE_BLOCK[env], lastFoundBestBlock: CARDANO_REFERENCE_BLOCK[env] } });
    }
    if (url === `${yoroi}/txs/utxoForAddresses`) {
      calls.push('utxoForAddresses');
      return json(chain.utxos ?? [], chain.status ?? 200);
    }
    if (url === `${yoroi}/txs/utxoSumForAddresses`) {
      calls.push('utxoSumForAddresses');
      return json({ sum: chain.sum ?? '0', tokensBalance: [] }, chain.status ?? 200);
    }
    throw new Error(`unexpected request to ${url}`);
  }) as typeof fetch;
  return { calls, submitted };
}

const row = (receiver: string, txHash: string, index: number, amount: string, extra: Record<string, unknown> = {}) => ({
  utxo_id: `${txHash}:${index}`,
  tx_hash: txHash,
  tx_index: index,
  receiver,
  amount,
  assets: [],
  block_num: 1,
  script_ref: null,
  ...extra,
});
const TOKEN = { assetId: 'ab.cd', policyId: 'ab'.repeat(28), name: 'cd', amount: '1' };

function transfer(env: ChainNet, over: Partial<FamilyTransfer> = {}): FamilyTransfer {
  return {
    network: 'cardano',
    env,
    def: NETWORKS.cardano,
    secret: cardanoPaymentSecret(DEBUG_ENTROPY),
    owner: env === 'mainnet' ? DEBUG_ADDRESS : DEBUG_TEST_ADDRESS,
    asset: 'native',
    to: env === 'mainnet' ? CIP19.base : CIP19.testBase,
    amount: 2_000_000n,
    maxFee: 1_200_000n,
    ...over,
  };
}

test('a transfer spends ADA-only UTXOs, pays the recipient, returns change, signs and is accepted', async () => {
  const utxos = [
    row(DEBUG_ADDRESS, '11'.repeat(32), 0, '5000000'),
    row(DEBUG_ADDRESS, '22'.repeat(32), 1, '20000000', { assets: [TOKEN] }),
    row(DEBUG_ADDRESS, '23'.repeat(32), 0, '30000000', { script_ref: '82008200' }),
  ];
  const { calls, submitted } = services('mainnet', { utxos, slot: 201_000_000 });
  const id = await sendCardano(transfer('mainnet'));
  assert.equal(submitted.length, 1);
  assert.equal(calls.at(-1), 'submitTransaction');
  for (const call of ['queryNetwork/genesisConfiguration', 'tipStatus', 'queryLedgerState/protocolParameters', 'queryNetwork/tip', 'utxoForAddresses']) {
    assert.ok(calls.includes(call), call);
  }
  const { body, fields, vkey, signature } = takeApart(submitted[0]);
  const hash = blake2b(body, { dkLen: 32 });
  assert.equal(id, bytesToHex(hash));
  assert.deepEqual(vkey, cardanoPublicKey(cardanoPaymentSecret(DEBUG_ENTROPY)));
  assert.deepEqual(blake2b(vkey, { dkLen: 28 }), keyHashOf(DEBUG_ADDRESS));
  assert.ok(ed25519.verify(signature, hash, vkey));
  // Only the ADA-only UTXO is an input: the token one and the reference-script one stay put.
  const inputs = fields.get(0) as unknown as { tag: bigint; item: { items: { items: [{ value: Uint8Array }, { value: bigint }] }[] } };
  assert.equal(inputs.tag, 258n);
  assert.deepEqual(
    inputs.item.items.map(({ items: [h, i] }) => [bytesToHex(h.value), i.value]),
    [['11'.repeat(32), 0n]],
  );
  const fee = (fields.get(2) as { value: bigint }).value;
  const outputs = outputsOf(fields);
  assert.deepEqual(outputs[0], [bytesToHex(bytesOf(CIP19.base)), 2_000_000n]);
  assert.deepEqual(outputs[1], [bytesToHex(bytesOf(DEBUG_ADDRESS)), 5_000_000n - 2_000_000n - fee]);
  assert.ok(fee >= cardanoMinFee(submitted[0].length, PARAMS));
  assert.deepEqual(fields.get(3), { type: 'uint', value: BigInt(201_000_000 + CARDANO_TTL_SLOTS) });
  assert.deepEqual(fields.get(15), { type: 'uint', value: 1n });
});

test('in test mode it is Preprod end to end: its services, its addresses, network id 0', async () => {
  const { submitted } = services('testnet', { utxos: [row(DEBUG_TEST_ADDRESS, '11'.repeat(32), 0, '5000000')] });
  const id = await sendCardano(transfer('testnet'));
  const { body, fields } = takeApart(submitted[0]);
  assert.equal(id, bytesToHex(blake2b(body, { dkLen: 32 })));
  assert.deepEqual(fields.get(15), { type: 'uint', value: 0n });
  assert.equal(outputsOf(fields)[1][0], bytesToHex(bytesOf(DEBUG_TEST_ADDRESS)));
});

test('refusals that need no service ask none: chain, address, memo', async () => {
  const cases: [Partial<FamilyTransfer>, string][] = [
    [{ network: 'eth' }, 'chain'],
    [{ def: NETWORKS.eth }, 'chain'],
    [{ asset: 'ab'.repeat(28) }, 'address'],
    [{ to: CIP19.testBase }, 'address'],
    [{ to: CIP19.reward }, 'address'],
    [{ to: CIP19.enterpriseScript }, 'address'],
    [{ to: 'addr1notanaddress' }, 'address'],
    [{ to: DEBUG_TEST_ADDRESS }, 'address'],
    [{ memo: 'invoice 42' }, 'memo'],
  ];
  for (const [over, code] of cases) {
    const { calls } = services('mainnet');
    assert.equal(await refusal(sendCardano(transfer('mainnet', over))), code, JSON.stringify(over));
    assert.deepEqual(calls, []);
  }
});

test('a key that does not control the sending address never reaches a service', async () => {
  const { calls } = services('mainnet');
  const message = await refusal(sendCardano(transfer('mainnet', { secret: cardanoPaymentSecret(entropyOf(ABOUT)) })));
  assert.match(String(message), /does not control/);
  assert.deepEqual(calls, []);
});

test('a node of another network, or a backend that does not know the network, is refused "chain"', async () => {
  for (const chain of [{ magic: 1 }, { magic: 2 }, { holds: false }] as Chain[]) {
    const { calls, submitted } = services('mainnet', { ...chain, utxos: [row(DEBUG_ADDRESS, '11'.repeat(32), 0, '5000000')] });
    assert.equal(await refusal(sendCardano(transfer('mainnet'))), 'chain');
    assert.equal(submitted.length, 0);
    // Nothing a signature would depend on was even asked for.
    assert.ok(!calls.includes('utxoForAddresses') && !calls.includes('queryLedgerState/protocolParameters'));
  }
  const { submitted } = services('testnet', { magic: 764_824_073 });
  assert.equal(await refusal(sendCardano(transfer('testnet'))), 'chain');
  assert.equal(submitted.length, 0);
});

test('unfunded, funds, minimum and fee are refused before anything is submitted', async () => {
  const cases: [Chain, Partial<FamilyTransfer>, string][] = [
    [{ utxos: [] }, {}, 'unfunded'],
    // The ADA sits with a token, which this transfer does not spend.
    [{ utxos: [row(DEBUG_ADDRESS, '11'.repeat(32), 0, '2100000'), row(DEBUG_ADDRESS, '22'.repeat(32), 0, '50000000', { assets: [TOKEN] })] }, {}, 'funds'],
    [{ utxos: [row(DEBUG_ADDRESS, '11'.repeat(32), 0, '5000000')] }, { amount: 900_000n }, 'minimum'],
    [{ utxos: [row(DEBUG_ADDRESS, '11'.repeat(32), 0, '5000000')] }, { maxFee: 100_000n }, 'fee'],
    // A node inflating the per-byte fee is refused, not paid.
    [{ utxos: [row(DEBUG_ADDRESS, '11'.repeat(32), 0, '50000000')], params: { ...OGMIOS_PARAMS, minFeeCoefficient: 5_000 } }, {}, 'fee'],
  ];
  for (const [chain, over, code] of cases) {
    const { submitted } = services('mainnet', chain);
    assert.equal(await refusal(sendCardano(transfer('mainnet', over))), code, code);
    assert.equal(submitted.length, 0);
  }
});

test('answers the transfer cannot stand behind are errors, and nothing is submitted', async () => {
  const cases: [Chain, RegExp][] = [
    [{ utxos: [row(CIP19.base, '11'.repeat(32), 0, '5000000')] }, /another address/],
    [{ utxos: [row(DEBUG_ADDRESS, '11'.repeat(32), 0, '5000000.5')] }, /Unexpected server response/],
    [{ utxos: [row(DEBUG_ADDRESS, 'zz', 0, '5000000')] }, /Unexpected server response/],
    [{ status: 503 }, /HTTP 503/],
    [{ params: { ...OGMIOS_PARAMS, minFeeCoefficient: 44.5 } }, /Unexpected server response/],
  ];
  for (const [chain, error] of cases) {
    const { submitted } = services('mainnet', { utxos: [row(DEBUG_ADDRESS, '11'.repeat(32), 0, '5000000')], ...chain });
    assert.match(String(await refusal(sendCardano(transfer('mainnet')))), error);
    assert.equal(submitted.length, 0);
  }
});

test('a submission the node refuses, or answers with another id, is an error naming only the code', async () => {
  const utxos = [row(DEBUG_ADDRESS, '11'.repeat(32), 0, '5000000')];
  services('mainnet', { utxos, submit: () => ({ error: { code: 3117, message: `unknown inputs at ${DEBUG_ADDRESS}` } }) });
  const message = String(await refusal(sendCardano(transfer('mainnet'))));
  assert.match(message, /code 3117/);
  assert.ok(!message.includes(DEBUG_ADDRESS));
  services('mainnet', { utxos, submit: () => ({ result: { transaction: { id: 'cd'.repeat(32) } } }) });
  assert.match(String(await refusal(sendCardano(transfer('mainnet')))), /another transaction id/);
});

test('the balance is the backend’s lovelace sum, exact past 2^53', async () => {
  const { calls } = services('mainnet', { sum: '123456789012345678' });
  assert.equal(await readCardanoBalance('mainnet', DEBUG_ADDRESS), 123_456_789_012_345_678n);
  assert.deepEqual(calls, ['utxoSumForAddresses']);
  services('testnet', { sum: '7' });
  assert.equal(await readCardanoBalance('testnet', DEBUG_TEST_ADDRESS), 7n);
  services('mainnet', { sum: 1e21 });
  await assert.rejects(readCardanoBalance('mainnet', DEBUG_ADDRESS));
  services('mainnet', { status: 500 });
  await assert.rejects(readCardanoBalance('mainnet', DEBUG_ADDRESS), /HTTP 500/);
  const { calls: none } = services('mainnet');
  await assert.rejects(readCardanoBalance('mainnet', DEBUG_TEST_ADDRESS));
  assert.deepEqual(none, []);
});

/* ------------------------------------ live ------------------------------------ */

const live = { skip: process.env.CARDANO_LIVE !== '1' };

test('live: both services of each mode are the network they claim', live, async () => {
  await assertCardanoNetwork('mainnet');
  await assertCardanoNetwork('testnet');
});

test('live: the debug wallet’s balances read', live, async () => {
  assert.ok((await readCardanoBalance('mainnet', DEBUG_ADDRESS)) >= 0n);
  assert.ok((await readCardanoBalance('testnet', DEBUG_TEST_ADDRESS)) >= 0n);
});

test('live: a mainnet dry run reads everything and stops before signing an empty address', live, async () => {
  // prepareCardanoTransfer never submits. The debug address is public; should it ever hold ADA
  // this answers a signed transaction, still unsent, instead of the refusal.
  try {
    const { tx, txId, fee } = await prepareCardanoTransfer(transfer('mainnet'));
    assert.equal(txId, bytesToHex(blake2b(takeApart(tx).body, { dkLen: 32 })));
    assert.ok(fee > 0n);
  } catch (e) {
    assert.equal((e as { code?: string }).code, 'unfunded');
  }
});

test('live: Preprod’s Ogmios decodes a signed transfer (evaluateTransaction, never submitted)', live, async () => {
  const plan = planCardanoTransfer({
    utxos: [{ txHash: 'ab'.repeat(32), index: 0, lovelace: 10_000_000n }],
    params: PARAMS,
    to: bytesOf(CIP19.testEnterprise),
    changeTo: bytesOf(DEBUG_TEST_ADDRESS),
    amount: 2_000_000n,
    ttl: 200_000_000n,
    networkId: 0,
  });
  const secret = cardanoPaymentSecret(DEBUG_ENTROPY);
  const tx = cardanoSignedTx(plan.body, cardanoPublicKey(secret), cardanoSign(secret, plan.bodyHash));
  const res = await fetch(CARDANO_ENDPOINTS.testnet.ogmios, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'evaluateTransaction', params: { transaction: { cbor: bytesToHex(tx) } } }),
  });
  // A transaction Ogmios cannot decode in any era is error -32602; a decoded one without scripts
  // evaluates to an empty list.
  assert.deepEqual(((await res.json()) as { result?: unknown }).result, []);
});
