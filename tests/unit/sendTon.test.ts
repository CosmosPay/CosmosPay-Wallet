/**
 * Paying TON from the wallet's v4R2 contract (src/lib/send/ton.ts), against a stubbed toncenter.
 * Pinned: the cells hash the way TON hashes them (the empty cell, the embedded v4R2 code against
 * the constants `lib/addresses/ton.ts` derives every address from, the StateInit against the
 * debug wallet's address), the BOC round-trips, and the signed message is exactly what a v4R2
 * wallet accepts — signature over the payload, subwallet, expiry, seqno, mode 3, the transfer with
 * the recipient's bounce flag and the comment, and the StateInit on a first send. Every refusal is
 * a code, and nothing is broadcast when one is raised; test mode and a node that is not TON
 * mainnet are refused before anything is signed.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base64, base64url } from '@scure/base';
import { mnemonicToSeed } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { DEBUG_WALLET_PHRASE } from '@/constants/debug';
import { DERIVATION_PATHS, NETWORKS } from '@/constants/networks';
import { TON_KEEP_ALIVE, TON_MAINNET_ZEROSTATE, TON_V4R2_SUBWALLET_ID, TON_WALLET_V4R2_CODE_BOC } from '@/constants/tonSend';
import { tonWalletAddress } from '@/lib/addresses/ton';
import { isTonAddress, parseTonAddress, sendTon, tonCommentCell, tonWalletStateInit } from '@/lib/send/ton';
import { TonCellBuilder, parseBoc, serializeBoc, type TonCell } from '@/lib/send/tonCell';
import type { FamilyTransfer } from '@/lib/send/types';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/* ------------------------------ helpers ------------------------------ */

/** Reads a cell back field by field, the way the contract does. */
class Reader {
  private at = 0;
  private next = 0;
  private readonly cell: TonCell;
  constructor(cell: TonCell) {
    this.cell = cell;
  }
  bit(): boolean {
    assert.ok(this.at < this.cell.bits, 'read past the end of the cell');
    const on = (this.cell.data[this.at >> 3] & (0x80 >> (this.at & 7))) !== 0;
    this.at++;
    return on;
  }
  uint(width: number): bigint {
    let v = 0n;
    for (let i = 0; i < width; i++) v = (v << 1n) | (this.bit() ? 1n : 0n);
    return v;
  }
  bytes(n: number): Uint8Array {
    return Uint8Array.from({ length: n }, () => Number(this.uint(8)));
  }
  coins(): bigint {
    return this.uint(Number(this.uint(4)) * 8);
  }
  address(): { workchain: number; account: string } {
    assert.equal(this.uint(2), 0b10n, 'addr_std');
    assert.equal(this.bit(), false, 'no anycast');
    const wc = Number(this.uint(8));
    return { workchain: wc >= 128 ? wc - 256 : wc, account: bytesToHex(this.bytes(32)) };
  }
  ref(): TonCell {
    return this.cell.refs[this.next++];
  }
  /** What is left, as the cell `slice_hash` hashes. */
  rest(): TonCell {
    const b = new TonCellBuilder();
    while (this.at < this.cell.bits) b.bit(this.bit());
    while (this.next < this.cell.refs.length) b.ref(this.ref());
    return b.end();
  }
  get bitsLeft(): number {
    return this.cell.bits - this.at;
  }
  get refsLeft(): number {
    return this.cell.refs.length - this.next;
  }
}

const b64 = (hex: string) => base64.encode(hexToBytes(hex));
const MAINNET_INIT = { root_hash: b64(TON_MAINNET_ZEROSTATE.rootHash), file_hash: b64(TON_MAINNET_ZEROSTATE.fileHash) };
const TESTNET_INIT = { root_hash: 'gj+B8wb/AmlPk1z1AhVI484rhrUpgSr2oSFIh56VoSg=', file_hash: 'Z+IKwYS54DmmJmesw/nAD5DzWadnOCMzee+kdgSYDOg=' };
/** The source fees toncenter estimated for a plain v4R2 send on mainnet (2026-10-29). */
const FEES = { in_fwd_fee: 100534, storage_fee: 4, gas_fee: 220534, fwd_fee: 66667 };
const FEE = 387_739n;

interface Call {
  method: string;
  body: Record<string, unknown> | null;
}

type Answer = unknown | ((call: Call) => { status: number; body: unknown });

/** A toncenter that answers each method as told (`{ ok: true, result }` unless a function says otherwise). */
function toncenter(answers: Record<string, Answer>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = new URL(String(url)).pathname.split('/').pop()!;
    const call = { method, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null };
    calls.push(call);
    if (!(method in answers)) throw new Error(`unexpected ${method}`);
    const answer = answers[method];
    const { status, body } = typeof answer === 'function' ? (answer as (c: Call) => { status: number; body: unknown })(call) : { status: 200, body: { ok: true, result: answer } };
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

const activeNode = (over: Record<string, Answer> = {}) =>
  toncenter({
    getMasterchainInfo: { init: MAINNET_INIT },
    getWalletInformation: { balance: '5000000000', account_state: 'active' },
    runGetMethod: { exit_code: 0, stack: [['num', '0x7']] },
    estimateFee: { source_fees: FEES },
    sendBoc: { '@type': 'ok' },
    ...over,
  });

const secret = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const publicKey = ed25519.getPublicKey(secret());
const owner = tonWalletAddress(publicKey);
const ownerAccount = bytesToHex(base64url.decode(owner).subarray(2, 34));

/** A user-friendly address with the given tag (0x11 / 0x51, | 0x80) and workchain byte. */
function friendly(tag: number, account: Uint8Array, wc = 0, urlSafe = true): string {
  const raw = new Uint8Array(36);
  raw[0] = tag;
  raw[1] = wc;
  raw.set(account, 2);
  let crc = 0;
  for (const b of raw.subarray(0, 34)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  raw[34] = crc >> 8;
  raw[35] = crc & 0xff;
  return (urlSafe ? base64url : base64).encode(raw);
}
const RECIPIENT = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i);
const BOUNCEABLE = friendly(0x11, RECIPIENT);
const NON_BOUNCEABLE = friendly(0x51, RECIPIENT);
const RAW = `0:${bytesToHex(RECIPIENT)}`;

const transfer = (over: Partial<FamilyTransfer> = {}): FamilyTransfer => ({
  network: 'ton',
  env: 'mainnet',
  def: NETWORKS.ton,
  secret: secret(),
  owner,
  asset: 'native',
  to: NON_BOUNCEABLE,
  amount: 1_000_000_000n,
  memo: 'invoice 42',
  maxFee: 10_000_000n,
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

const sentBoc = (calls: Call[]): TonCell => {
  const send = calls.find((c) => c.method === 'sendBoc');
  assert.ok(send, 'nothing was sent');
  return parseBoc(base64.decode(String(send.body!.boc)))[0];
};

/** The external message's parts, each field checked against what a v4R2 wallet reads. */
function readExternal(ext: TonCell) {
  const r = new Reader(ext);
  assert.equal(r.uint(2), 0b10n, 'ext_in_msg_info');
  assert.equal(r.uint(2), 0n, 'no source');
  assert.deepEqual(r.address(), { workchain: 0, account: ownerAccount });
  assert.equal(r.coins(), 0n, 'no import fee');
  const init = r.bit() ? (assert.equal(r.bit(), true, 'StateInit by reference'), r.ref()) : null;
  assert.equal(r.bit(), true, 'body by reference');
  const body = r.ref();
  assert.equal(r.bitsLeft + r.refsLeft, 0);

  const b = new Reader(body);
  const signature = b.bytes(64);
  const payload = b.rest();
  const p = new Reader(payload);
  const fields = { subwallet: Number(p.uint(32)), validUntil: Number(p.uint(32)), seqno: Number(p.uint(32)), op: Number(p.uint(8)), mode: Number(p.uint(8)) };
  const message = p.ref();
  assert.equal(p.bitsLeft + p.refsLeft, 0, 'one action');
  return { init, body, signature, payload, fields, message };
}

function readInternal(message: TonCell) {
  const m = new Reader(message);
  assert.equal(m.bit(), false, 'int_msg_info');
  assert.equal(m.bit(), true, 'ihr_disabled');
  const bounce = m.bit();
  assert.equal(m.bit(), false, 'not bounced');
  assert.equal(m.uint(2), 0n, 'no source');
  const dest = m.address();
  const value = m.coins();
  assert.equal(m.bit(), false, 'no extra currencies');
  assert.equal(m.coins(), 0n, 'ihr_fee');
  assert.equal(m.coins(), 0n, 'fwd_fee');
  assert.equal(m.uint(64), 0n, 'created_lt');
  assert.equal(m.uint(32), 0n, 'created_at');
  assert.equal(m.bit(), false, 'no StateInit');
  const comment = m.bit() ? m.ref() : null;
  assert.equal(m.bitsLeft + m.refsLeft, 0);
  return { bounce, dest, value, comment };
}

function readComment(cell: TonCell): string {
  const r = new Reader(cell);
  assert.equal(r.uint(32), 0n, 'text comment op');
  const out: number[] = [];
  let cur: Reader = r;
  for (;;) {
    out.push(...cur.bytes(cur.bitsLeft / 8));
    if (!cur.refsLeft) break;
    cur = new Reader(cur.ref());
  }
  return new TextDecoder().decode(Uint8Array.from(out));
}

/* ------------------------------- cells ------------------------------- */

test('cells hash and serialize the way TON does', () => {
  const empty = new TonCellBuilder().end();
  assert.equal(bytesToHex(empty.hash), '96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7');
  // The empty cell's BOC as every TON library writes it (no index, CRC32C).
  assert.equal(base64.encode(serializeBoc(empty)), 'te6cckEBAQEAAgAAAEysuc0=');
  assert.equal(bytesToHex(parseBoc(base64.decode('te6cckEBAQEAAgAAAEysuc0='))[0].hash), bytesToHex(empty.hash));
  // The completion tag: 0b1 and 0b10 are different cells.
  assert.notEqual(bytesToHex(new TonCellBuilder().bit(true).end().hash), bytesToHex(new TonCellBuilder().bit(true).bit(false).end().hash));
});

test('the embedded v4R2 code is the code every wallet address is derived from', () => {
  const [code] = parseBoc(base64.decode(TON_WALLET_V4R2_CODE_BOC));
  assert.equal(bytesToHex(code.hash), 'feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0');
  assert.equal(code.depth, 7);
  // …which are the constants lib/addresses/ton.ts hashes into every address.
  const source = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'lib', 'addresses', 'ton.ts'), 'utf8');
  assert.equal(/V4R2_CODE_HASH = hexToBytes\('([0-9a-f]{64})'\)/.exec(source)?.[1], bytesToHex(code.hash));
  assert.equal(Number(/V4R2_CODE_DEPTH = (\d+);/.exec(source)?.[1]), code.depth);
  assert.equal(Number(/V4R2_SUBWALLET_ID = (\d+);/.exec(source)?.[1]), TON_V4R2_SUBWALLET_ID);
});

test('a BOC round-trips, writes a shared cell once and refuses corruption', () => {
  const [code] = parseBoc(base64.decode(TON_WALLET_V4R2_CODE_BOC));
  const boc = serializeBoc(code);
  const [again] = parseBoc(boc);
  assert.equal(bytesToHex(again.hash), bytesToHex(code.hash));
  assert.deepEqual(serializeBoc(again), boc);

  const leaf = new TonCellBuilder().uint(0xabc, 12).end();
  const root = new TonCellBuilder()
    .bit(true)
    .ref(new TonCellBuilder().ref(leaf).end())
    .ref(new TonCellBuilder().bit(false).ref(leaf).end())
    .end();
  const dag = serializeBoc(root);
  assert.equal(dag[6], 4, 'four distinct cells');
  assert.equal(bytesToHex(parseBoc(dag)[0].hash), bytesToHex(root.hash));

  const flipped = dag.slice();
  flipped[12] ^= 1;
  assert.throws(() => parseBoc(flipped), /CRC32C/);
  assert.throws(() => parseBoc(dag.subarray(0, dag.length - 5)), /TON BOC/);
});

test("the StateInit reproduces the debug wallet's TON address", async () => {
  const seed = await mnemonicToSeed(DEBUG_WALLET_PHRASE);
  const key = Uint8Array.from(derivePath(DERIVATION_PATHS.ton, seed.toString('hex')).key);
  const pub = ed25519.getPublicKey(key);
  const { init } = tonWalletStateInit(pub);
  const address = tonWalletAddress(pub);
  assert.equal(address, 'UQCogCt3umDv0NtKrNFjut50sda8ogtxpwxh-rwp80SPtjdr');
  assert.equal(bytesToHex(init.hash), bytesToHex(base64url.decode(address).subarray(2, 34)));
});

test('a comment is op 0 and UTF-8, continued in a chain of references', () => {
  assert.equal(readComment(tonCommentCell('invoice 42')), 'invoice 42');
  const long = 'añ€'.repeat(60); // 360 bytes: three cells, multi-byte characters split across them
  const cell = tonCommentCell(long);
  assert.equal(cell.bits, 32 + 123 * 8);
  assert.equal(cell.refs[0].bits, 127 * 8);
  assert.equal(readComment(cell), long);
});

/* ------------------------------ addresses ------------------------------ */

test('recipients: user-friendly in both alphabets and raw; the flags are read', () => {
  assert.deepEqual(parseTonAddress(BOUNCEABLE), { workchain: 0, account: RECIPIENT, bounceable: true, testOnly: false });
  assert.equal(parseTonAddress(NON_BOUNCEABLE)?.bounceable, false);
  assert.equal(parseTonAddress(friendly(0x11, RECIPIENT, 0, false))?.bounceable, true);
  assert.deepEqual(parseTonAddress(RAW), { workchain: 0, account: RECIPIENT, bounceable: true, testOnly: false });
  assert.equal(parseTonAddress(`-1:${bytesToHex(RECIPIENT).toUpperCase()}`)?.workchain, -1);
  assert.equal(parseTonAddress(friendly(0x11, RECIPIENT, 0xff))?.workchain, -1);
  assert.equal(parseTonAddress(friendly(0x91, RECIPIENT))?.testOnly, true);

  for (const bad of [
    '',
    BOUNCEABLE.slice(0, 47),
    `${BOUNCEABLE.slice(0, 47)}${BOUNCEABLE[47] === 'A' ? 'B' : 'A'}`, // checksum
    friendly(0x12, RECIPIENT), // tag
    friendly(0x11, RECIPIENT, 1), // workchain
    `${BOUNCEABLE.slice(0, 46).replace(/[A-Za-z0-9]/, '+')}-_`, // mixed alphabets
    `1:${bytesToHex(RECIPIENT)}`,
    `0:${bytesToHex(RECIPIENT).slice(2)}`,
    ` ${BOUNCEABLE}`,
  ]) {
    assert.equal(parseTonAddress(bad), null, bad);
    assert.equal(isTonAddress('ton', bad, 'mainnet'), false, bad);
  }
  assert.equal(isTonAddress('ton', BOUNCEABLE, 'mainnet'), true);
  assert.equal(isTonAddress('ton', friendly(0xd1, RECIPIENT), 'mainnet'), false, 'test-only on mainnet');
  assert.equal(isTonAddress('ton', friendly(0xd1, RECIPIENT), 'testnet'), true);
  assert.equal(isTonAddress('near', BOUNCEABLE, 'mainnet'), false);
});

/* -------------------------------- sends -------------------------------- */

test('a send from a deployed wallet signs the v4R2 payload and broadcasts it', async () => {
  const calls = activeNode();
  const before = Math.floor(Date.now() / 1000);
  const id = await sendTon(transfer(), 0);
  assert.deepEqual(
    calls.map((c) => c.method),
    ['getMasterchainInfo', 'getWalletInformation', 'runGetMethod', 'estimateFee', 'sendBoc'],
  );
  assert.deepEqual(calls[2].body, { address: owner, method: 'seqno', stack: [] });

  const ext = sentBoc(calls);
  const { init, signature, payload, fields, message } = readExternal(ext);
  assert.equal(init, null, 'a deployed wallet carries no StateInit');
  assert.ok(ed25519.verify(signature, payload.hash, publicKey), 'signed over the payload hash');
  assert.equal(fields.subwallet, TON_V4R2_SUBWALLET_ID);
  assert.ok(fields.validUntil >= before + 55 && fields.validUntil <= before + 65, 'valid for about a minute');
  assert.equal(fields.seqno, 7);
  assert.equal(fields.op, 0);
  assert.equal(fields.mode, 3);

  const msg = readInternal(message);
  assert.equal(msg.bounce, false, 'UQ: non-bounceable');
  assert.deepEqual(msg.dest, { workchain: 0, account: bytesToHex(RECIPIENT) });
  assert.equal(msg.value, 1_000_000_000n);
  assert.equal(readComment(msg.comment!), 'invoice 42');

  // The fee was estimated on the same payload, unsigned, without a StateInit.
  const est = calls[3].body!;
  assert.equal(est.ignore_chksig, true);
  assert.equal(est.init_code, undefined);
  const estimated = readExternal(new TonCellBuilder().uint(0b10, 2).uint(0, 2).address(0, hexToBytes(ownerAccount)).coins(0n).bit(false).bit(true).ref(parseBoc(base64.decode(String(est.body)))[0]).end());
  assert.deepEqual(estimated.signature, new Uint8Array(64));
  assert.equal(bytesToHex(estimated.payload.hash), bytesToHex(payload.hash));

  // Without a StateInit the normalized hash is the message's own.
  assert.equal(id, bytesToHex(ext.hash));
});

test("the bounce flag is the recipient's own; no comment means an empty body", async () => {
  for (const [to, bounce] of [
    [BOUNCEABLE, true],
    [NON_BOUNCEABLE, false],
    [RAW, true],
  ] as const) {
    const calls = activeNode();
    await sendTon(transfer({ to, memo: undefined }), 0);
    const msg = readInternal(readExternal(sentBoc(calls)).message);
    assert.equal(msg.bounce, bounce, to);
    assert.equal(msg.comment, null);
  }
});

test('the first send deploys the wallet: StateInit attached, seqno 0, no get-method', async () => {
  const calls = activeNode({ getWalletInformation: { balance: '2000000000', account_state: 'uninitialized' } });
  const id = await sendTon(transfer(), 0);
  assert.ok(!calls.some((c) => c.method === 'runGetMethod'));

  const ext = sentBoc(calls);
  const { init, signature, payload, fields, body } = readExternal(ext);
  assert.ok(init, 'StateInit attached');
  assert.equal(bytesToHex(init.hash), ownerAccount, "the StateInit is our address's");
  assert.equal(fields.seqno, 0);
  assert.ok(ed25519.verify(signature, payload.hash, publicKey));

  const { code, data } = tonWalletStateInit(publicKey);
  const est = calls.find((c) => c.method === 'estimateFee')!.body!;
  assert.equal(est.init_code, base64.encode(serializeBoc(code)));
  assert.equal(est.init_data, base64.encode(serializeBoc(data)));

  // The id is TEP-467's normalized hash: the same message without its StateInit.
  const normalized = new TonCellBuilder().uint(0b10, 2).uint(0, 2).address(0, hexToBytes(ownerAccount)).coins(0n).bit(false).bit(true).ref(body).end();
  assert.equal(id, bytesToHex(normalized.hash));
  assert.notEqual(id, bytesToHex(ext.hash));
});

test('a rate-limited request is tried again', async () => {
  let first = true;
  const calls = activeNode({
    getMasterchainInfo: () => {
      if (first) {
        first = false;
        return { status: 429, body: { ok: false, error: 'Ratelimit exceed', code: 429 } };
      }
      return { status: 200, body: { ok: true, result: { init: MAINNET_INIT } } };
    },
  });
  await sendTon(transfer(), 0);
  assert.equal(calls.filter((c) => c.method === 'getMasterchainInfo').length, 2);
});

test('a message the node rejects is an error with its exit code, not an id', async () => {
  activeNode({
    sendBoc: () => ({ status: 500, body: { ok: false, error: 'LITE_SERVER_UNKNOWN: inbound external message rejected by transaction ABC: exitcode=33, steps=40, gas_used=0', code: 500 } }),
  });
  assert.equal(await refusal(sendTon(transfer(), 0)), 'toncenter sendBoc failed (HTTP 500, exit code 33)');
});

/* ------------------------------- refusals ------------------------------- */

test('test mode is refused before any request: a testnet v4R2 transfer replays on mainnet', async () => {
  const calls = activeNode();
  assert.equal(await refusal(sendTon(transfer({ env: 'testnet' }), 0)), 'chain');
  assert.equal(calls.length, 0);
});

test('a node that is not TON mainnet is refused before anything is signed', async () => {
  const calls = activeNode({ getMasterchainInfo: { init: TESTNET_INIT } });
  assert.equal(await refusal(sendTon(transfer(), 0)), 'chain');
  assert.deepEqual(
    calls.map((c) => c.method),
    ['getMasterchainInfo'],
  );
});

test('a network that is not TON, or an endpoint of another kind, is refused', async () => {
  const calls = activeNode();
  assert.equal(await refusal(sendTon(transfer({ network: 'near' }), 0)), 'chain');
  assert.equal(await refusal(sendTon(transfer({ def: NETWORKS.near }), 0)), 'chain');
  assert.equal(calls.length, 0);
});

test('only the coin, to a valid mainnet address, of a positive amount, with a carried comment', async () => {
  const calls = activeNode();
  assert.equal(await refusal(sendTon(transfer({ asset: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs' }), 0)), 'address');
  assert.equal(await refusal(sendTon(transfer({ to: 'not an address' }), 0)), 'address');
  assert.equal(await refusal(sendTon(transfer({ to: friendly(0xd1, RECIPIENT) }), 0)), 'address');
  assert.equal(await refusal(sendTon(transfer({ amount: 0n }), 0)), 'minimum');
  assert.equal(await refusal(sendTon(transfer({ memo: 'x'.repeat(121) }), 0)), 'memo');
  assert.equal(await refusal(sendTon(transfer({ memo: '€'.repeat(41) }), 0)), 'memo', '123 UTF-8 bytes');
  assert.equal(calls.length, 0, 'refused before any request');

  await sendTon(transfer({ memo: '€'.repeat(40) }), 0); // 120 bytes: carried
  assert.equal(readComment(readInternal(readExternal(sentBoc(calls)).message).comment!), '€'.repeat(40));
});

test('a key that does not control the owner address is an error, before any request', async () => {
  const calls = activeNode();
  const other = tonWalletAddress(ed25519.getPublicKey(Uint8Array.from({ length: 32 }, () => 9)));
  assert.match(String(await refusal(sendTon(transfer({ owner: other }), 0))), /does not control/);
  assert.equal(calls.length, 0);
});

test('a fee above maxFee is refused, not paid', async () => {
  const calls = activeNode();
  assert.equal(await refusal(sendTon(transfer({ maxFee: FEE - 1n }), 0)), 'fee');
  assert.ok(!calls.some((c) => c.method === 'sendBoc'));
  activeNode();
  assert.equal(await refusal(sendTon(transfer({ maxFee: FEE }), 0)), null, 'exactly maxFee is paid');
});

test('the amount, the fee and the keep-alive must all fit the balance', async () => {
  const amount = 1_000_000_000n;
  const exact = amount + FEE + TON_KEEP_ALIVE;
  let calls = activeNode({ getWalletInformation: { balance: String(exact - 1n), account_state: 'active' } });
  assert.equal(await refusal(sendTon(transfer({ amount }), 0)), 'funds');
  assert.ok(!calls.some((c) => c.method === 'sendBoc'));

  // Short of the amount and the keep-alive alone: refused before the fee is even estimated.
  calls = activeNode({ getWalletInformation: { balance: String(amount), account_state: 'active' } });
  assert.equal(await refusal(sendTon(transfer({ amount }), 0)), 'funds');
  assert.ok(!calls.some((c) => c.method === 'estimateFee' || c.method === 'sendBoc'));

  activeNode({ getWalletInformation: { balance: String(exact), account_state: 'active' } });
  assert.equal(await refusal(sendTon(transfer({ amount }), 0)), null);
});

test('an account that never received anything is unfunded; a frozen one has no funds', async () => {
  let calls = activeNode({ getWalletInformation: { balance: '0', account_state: 'uninitialized' } });
  assert.equal(await refusal(sendTon(transfer(), 0)), 'unfunded');
  assert.ok(!calls.some((c) => c.method === 'sendBoc'));
  calls = activeNode({ getWalletInformation: { balance: '0', account_state: 'frozen' } });
  assert.equal(await refusal(sendTon(transfer(), 0)), 'funds');
  assert.ok(!calls.some((c) => c.method === 'sendBoc'));
});

test('answers of the wrong shape are errors and send nothing', async () => {
  for (const over of [
    { getWalletInformation: { balance: 12.5, account_state: 'active' } },
    { runGetMethod: { exit_code: 0, stack: [] } },
    { runGetMethod: { exit_code: 0, stack: [['num', '-0x1']] } },
    { estimateFee: { source_fees: { ...FEES, gas_fee: '1e9' } } },
  ]) {
    const calls = activeNode(over);
    const outcome = await refusal(sendTon(transfer(), 0));
    assert.ok(outcome && !['fee', 'funds', 'chain'].includes(outcome), String(outcome));
    assert.ok(!calls.some((c) => c.method === 'sendBoc'));
  }
});
