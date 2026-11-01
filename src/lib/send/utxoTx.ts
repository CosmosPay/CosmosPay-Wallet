/**
 * The Bitcoin-family transaction, written by hand: the wire format, the two signature digests
 * the wallet signs and the scripts it pays to. `lib/send/utxo.ts` builds a plain payment with it
 * on Bitcoin, Litecoin, Dogecoin, Dash and Bitcoin Cash.
 *
 *  - **Legacy digest** (Bitcoin's original `SignatureHash`): the transaction re-serialized with
 *    the spent output's script in the signed input and empty scripts elsewhere, then the hash
 *    type. Dogecoin and Dash sign their P2PKH inputs with it.
 *  - **BIP143 digest**: hashes of every outpoint, sequence and output, plus the spent output's
 *    VALUE — so a node lying about an input's amount gets a signature that fails, never one that
 *    pays a fee nobody saw. Bitcoin and Litecoin sign native P2WPKH inputs with it (hash type
 *    `SIGHASH_ALL`); Bitcoin Cash signs P2PKH with the same digest under `SIGHASH_ALL|FORKID`
 *    (0x41), which Bitcoin's rules refuse — a Bitcoin Cash signature is never a Bitcoin one.
 *
 * Only `SIGHASH_ALL` is implemented: every input and output is signed, so nothing about the
 * transaction can change after the signature. Signatures are RFC 6979 (deterministic) and low-S
 * DER, the only form these networks relay.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';

/** A coin being spent: the outpoint (txid as explorers show it, big-endian hex) and its sequence. */
export interface TxIn {
  txid: string;
  vout: number;
  sequence: number;
}

/** A coin being created: its value in minor units and its locking script. */
export interface TxOut {
  value: bigint;
  script: Uint8Array;
}

export interface Tx {
  version: number;
  inputs: TxIn[];
  outputs: TxOut[];
  locktime: number;
}

export const dsha256 = (data: Uint8Array): Uint8Array => sha256(sha256(data));

const MAX_U64 = (1n << 64n) - 1n;

/** Bitcoin's CompactSize. */
export function varint(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('varint: not a non-negative integer');
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >>> 8);
  if (n <= 0xffffffff) return concatBytes(Uint8Array.of(0xfe), u32(n));
  throw new Error('varint: too large');
}

/** A 32-bit little-endian field. Hash types arrive signed from test vectors, so `>>> 0` first. */
export function u32(n: number): Uint8Array {
  const v = n >>> 0;
  return Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24);
}

/** A 64-bit little-endian amount; anything outside 0 … 2^64−1 is a bug, never wrapped. */
export function u64(value: bigint): Uint8Array {
  if (value < 0n || value > MAX_U64) throw new Error('amount out of range');
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** A script (or any byte string) with its length in front. */
export const withLength = (bytes: Uint8Array): Uint8Array => concatBytes(varint(bytes.length), bytes);

/** The txid as it travels: the displayed hex, byte-reversed. */
function txidLE(txid: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('txid: not 32 bytes of lowercase hex');
  return hexToBytes(txid).reverse();
}

const outpoint = (input: TxIn): Uint8Array => concatBytes(txidLE(input.txid), u32(input.vout));

export function serializeOutputs(outputs: readonly TxOut[]): Uint8Array {
  return concatBytes(...outputs.map((o) => concatBytes(u64(o.value), withLength(o.script))));
}

/**
 * The transaction on the wire. With any witness, the BIP144 form (marker 0x00, flag 0x01, one
 * stack per input after the outputs); without, the legacy form — which is also what the txid
 * hashes, so `witnesses` is left out to compute it.
 */
export function serializeTx(tx: Tx, scriptSigs: readonly Uint8Array[], witnesses?: readonly (readonly Uint8Array[])[]): Uint8Array {
  if (scriptSigs.length !== tx.inputs.length) throw new Error('one scriptSig per input');
  const segwit = !!witnesses && witnesses.some((w) => w.length > 0);
  if (segwit && witnesses.length !== tx.inputs.length) throw new Error('one witness per input');
  const parts: Uint8Array[] = [u32(tx.version)];
  if (segwit) parts.push(Uint8Array.of(0x00, 0x01));
  parts.push(varint(tx.inputs.length));
  tx.inputs.forEach((input, i) => parts.push(outpoint(input), withLength(scriptSigs[i]), u32(input.sequence)));
  parts.push(varint(tx.outputs.length), serializeOutputs(tx.outputs));
  if (segwit) for (const stack of witnesses) parts.push(varint(stack.length), ...stack.map(withLength));
  parts.push(u32(tx.locktime));
  return concatBytes(...parts);
}

/** The txid: double SHA-256 of the legacy (witness-free) serialization, displayed reversed. */
export function txidOf(tx: Tx, scriptSigs: readonly Uint8Array[]): string {
  return bytesToHex(dsha256(serializeTx(tx, scriptSigs)).reverse());
}

/**
 * The outputs of a legacy-format (witness-free) raw transaction, read from its bytes. Everything
 * after the outputs — the locktime, and the extra payload of a Dash special transaction — is left
 * unread: the caller checks the whole byte string against its txid, so what counts is that the
 * outputs come from bytes that hash to it. Throws on anything malformed or truncated.
 */
export function rawTxOutputs(raw: Uint8Array): TxOut[] {
  let o = 0;
  const need = (n: number) => {
    if (n < 0 || o + n > raw.length) throw new Error('raw transaction truncated');
  };
  const skip = (n: number) => {
    need(n);
    o += n;
  };
  const readVarint = (): number => {
    need(1);
    const first = raw[o++];
    if (first < 0xfd) return first;
    const len = first === 0xfd ? 2 : first === 0xfe ? 4 : 8;
    need(len);
    let v = 0;
    for (let i = len - 1; i >= 0; i--) v = v * 256 + raw[o + i];
    o += len;
    if (!Number.isSafeInteger(v)) throw new Error('raw transaction: count out of range');
    return v;
  };
  skip(4); // version (Dash: version and type)
  const inputs = readVarint();
  // A zero input count is segwit's marker; these networks have no segwit and no input-less transaction.
  if (inputs === 0) throw new Error('raw transaction: no inputs (or a witness marker)');
  for (let i = 0; i < inputs; i++) {
    skip(36);
    skip(readVarint());
    skip(4);
  }
  const count = readVarint();
  const outputs: TxOut[] = [];
  for (let i = 0; i < count; i++) {
    need(8);
    let value = 0n;
    for (let b = 7; b >= 0; b--) value = (value << 8n) | BigInt(raw[o + b]);
    o += 8;
    const len = readVarint();
    need(len);
    outputs.push({ value, script: raw.slice(o, o + len) });
    o += len;
  }
  need(4); // the locktime at least
  return outputs;
}

/** Only `SIGHASH_ALL` semantics are built (no NONE, SINGLE or ANYONECANPAY), so refuse the rest. */
function assertAll(hashType: number): void {
  const base = hashType & 0x1f;
  if (base === 0x02 || base === 0x03 || hashType & 0x80) throw new Error('only SIGHASH_ALL is supported');
}

/**
 * Bitcoin's original signature digest of input `index`, `SIGHASH_ALL` semantics. `scriptCode` is
 * the spent output's script (for P2PKH, the P2PKH script itself); Bitcoin Core would strip any
 * OP_CODESEPARATOR from it, which a P2PKH script never holds.
 */
export function legacySighash(tx: Tx, index: number, scriptCode: Uint8Array, hashType: number): Uint8Array {
  assertAll(hashType);
  if (index < 0 || index >= tx.inputs.length) throw new Error('input index out of range');
  const scriptSigs = tx.inputs.map((_, i) => (i === index ? scriptCode : new Uint8Array(0)));
  return dsha256(concatBytes(serializeTx(tx, scriptSigs), u32(hashType)));
}

/**
 * The BIP143 digest of input `index`, `SIGHASH_ALL` semantics: segwit v0's (hash type 0x01) and
 * Bitcoin Cash's (0x41, `SIGHASH_ALL|FORKID`, fork id 0, so the hash type field is the type
 * itself). `scriptCode` is written with its length; `value` is the spent output's amount.
 */
export function bip143Sighash(tx: Tx, index: number, scriptCode: Uint8Array, value: bigint, hashType: number): Uint8Array {
  assertAll(hashType);
  if (index < 0 || index >= tx.inputs.length) throw new Error('input index out of range');
  const input = tx.inputs[index];
  const hashPrevouts = dsha256(concatBytes(...tx.inputs.map(outpoint)));
  const hashSequence = dsha256(concatBytes(...tx.inputs.map((i) => u32(i.sequence))));
  const hashOutputs = dsha256(serializeOutputs(tx.outputs));
  return dsha256(
    concatBytes(
      u32(tx.version),
      hashPrevouts,
      hashSequence,
      outpoint(input),
      withLength(scriptCode),
      u64(value),
      u32(input.sequence),
      hashOutputs,
      u32(tx.locktime),
      u32(hashType),
    ),
  );
}

/**
 * A signature as a script carries it: low-S DER of `digest` (RFC 6979, so the same transaction
 * always signs the same) and the hash type byte. Checked against the key before it is returned:
 * a fault in signing would otherwise leave a transaction the network refuses, or worse, leak k.
 */
export function signDigest(digest: Uint8Array, secret: Uint8Array, hashType: number): Uint8Array {
  const der = secp256k1.sign(digest, secret, { prehash: false, lowS: true, format: 'der' });
  const publicKey = secp256k1.getPublicKey(secret, true);
  if (!secp256k1.verify(der, digest, publicKey, { prehash: false, lowS: true, format: 'der' })) throw new Error('signature self-check failed');
  return concatBytes(der, Uint8Array.of(hashType & 0xff));
}

/* --------------------------------- scripts -------------------------------- */

const OP_0 = 0x00;
const OP_DUP = 0x76;
const OP_HASH160 = 0xa9;
const OP_HASH256 = 0xaa;
const OP_EQUAL = 0x87;
const OP_EQUALVERIFY = 0x88;
const OP_CHECKSIG = 0xac;
const OP_1 = 0x51;

/** A direct push of up to 75 bytes, the only pushes these scripts hold. */
function push(data: Uint8Array): Uint8Array {
  if (data.length < 1 || data.length > 75) throw new Error('push: 1 to 75 bytes');
  return concatBytes(Uint8Array.of(data.length), data);
}

function expectLength(bytes: Uint8Array, length: number, what: string): Uint8Array {
  if (bytes.length !== length) throw new Error(`${what}: expected ${length} bytes`);
  return bytes;
}

/** OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG. */
export const p2pkhScript = (hash: Uint8Array): Uint8Array =>
  concatBytes(Uint8Array.of(OP_DUP, OP_HASH160), push(expectLength(hash, 20, 'P2PKH')), Uint8Array.of(OP_EQUALVERIFY, OP_CHECKSIG));

/** OP_HASH160 <20> OP_EQUAL. */
export const p2shScript = (hash: Uint8Array): Uint8Array =>
  concatBytes(Uint8Array.of(OP_HASH160), push(expectLength(hash, 20, 'P2SH')), Uint8Array.of(OP_EQUAL));

/** Bitcoin Cash's P2SH32 (May 2023): OP_HASH256 <32> OP_EQUAL. */
export const p2sh32Script = (hash: Uint8Array): Uint8Array =>
  concatBytes(Uint8Array.of(OP_HASH256), push(expectLength(hash, 32, 'P2SH32')), Uint8Array.of(OP_EQUAL));

/** A native segwit output: OP_n <program>. */
export function witnessScript(version: number, program: Uint8Array): Uint8Array {
  if (!Number.isInteger(version) || version < 0 || version > 16) throw new Error('witness version out of range');
  return concatBytes(Uint8Array.of(version === 0 ? OP_0 : OP_1 + version - 1), push(program));
}

/** Whether `script` is a native segwit output (BIP141's pattern): its dust is priced as a witness spend. */
export function isWitnessScript(script: Uint8Array): boolean {
  const n = script.length;
  if (n < 4 || n > 42) return false;
  const op = script[0];
  return (op === OP_0 || (op >= OP_1 && op <= OP_1 + 15)) && script[1] === n - 2;
}

/** The P2PKH spend: <signature> <compressed public key>. */
export const p2pkhScriptSig = (signature: Uint8Array, publicKey: Uint8Array): Uint8Array => concatBytes(push(signature), push(publicKey));

/* ---------------------------------- sizes --------------------------------- */

/**
 * The largest signature a script carries here: a low-S DER signature is at most 71 bytes (r may
 * need a 0x00 pad, a low s never does) plus the hash type byte.
 */
const MAX_SIGNATURE_BYTES = 72;
const PUBLIC_KEY_BYTES = 33;

/** What one input of `kind` weighs at most: bytes outside the witness, and witness bytes. */
function inputWeightParts(kind: 'p2wpkh' | 'p2pkh'): { base: number; witness: number } {
  if (kind === 'p2wpkh') {
    // outpoint 36 + empty scriptSig 1 + sequence 4; witness: 2 items, each with its length.
    return { base: 41, witness: 1 + 1 + MAX_SIGNATURE_BYTES + 1 + PUBLIC_KEY_BYTES };
  }
  const scriptSig = 1 + MAX_SIGNATURE_BYTES + 1 + PUBLIC_KEY_BYTES;
  return { base: 36 + varint(scriptSig).length + scriptSig + 4, witness: 0 };
}

/**
 * An upper bound on the virtual size (BIP141: ceil(weight / 4)) of a transaction spending `inputs`
 * coins of `kind` into `outputs`: every signature counted at its longest, so the fee rate paid is
 * never below the one asked. On networks without segwit this is the plain size.
 */
export function maxVsize(kind: 'p2wpkh' | 'p2pkh', inputs: number, outputs: readonly Uint8Array[]): number {
  const one = inputWeightParts(kind);
  const outs = outputs.reduce((n, script) => n + 8 + varint(script.length).length + script.length, 0);
  const base = 4 + varint(inputs).length + inputs * one.base + varint(outputs.length).length + outs + 4;
  // The marker and flag are witness bytes too.
  const witness = kind === 'p2wpkh' ? 2 + inputs * one.witness : 0;
  return Math.ceil((base * 4 + witness) / 4);
}
