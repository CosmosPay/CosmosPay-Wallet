/**
 * The CBOR (RFC 8949) a Cardano transfer needs, written by hand: no dependency covers it, and
 * a transfer only ever uses a handful of shapes.
 *
 * Encoding is piecewise — each helper answers the bytes of one item, and arrays and maps take
 * their members already encoded — so the bytes the wallet hashes and signs are exactly the bytes
 * it builds, with no value model in between that could re-encode them differently. Every head is
 * the shortest form (RFC 8949 §4.2.1): the ledger hashes the bytes as sent, and a transaction's
 * size, which sets its fee, is the size of these bytes.
 *
 * Decoding is strict and only as wide as the wallet reads: definite lengths, no floats, no
 * trailing bytes, a bounded depth. It reads a Byron address (`lib/send/cardano.ts`) and lets the
 * tests take a built transaction apart; anything outside that is an error, not a guess.
 */

const MAX_UINT64 = (1n << 64n) - 1n;
/** Deeper than any Byron address or transfer the wallet decodes; past it is hostile input. */
const MAX_DEPTH = 16;

function head(major: number, n: bigint): Uint8Array {
  if (n < 0n || n > MAX_UINT64) throw new Error('CBOR: argument out of range');
  const m = major << 5;
  if (n < 24n) return Uint8Array.of(m | Number(n));
  if (n < 0x100n) return Uint8Array.of(m | 24, Number(n));
  if (n < 0x1_0000n) return Uint8Array.of(m | 25, Number(n >> 8n), Number(n & 0xffn));
  const wide = n < 0x1_0000_0000n ? 4 : 8;
  const out = new Uint8Array(1 + wide);
  out[0] = m | (wide === 4 ? 26 : 27);
  for (let i = wide; i >= 1; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Major type 0: an unsigned integer up to 2^64 − 1. */
export function cborUint(n: bigint | number): Uint8Array {
  if (typeof n === 'number' && !Number.isSafeInteger(n)) throw new Error('CBOR: not an integer');
  return head(0, BigInt(n));
}

/** Major type 2: a byte string. */
export function cborBytes(bytes: Uint8Array): Uint8Array {
  return join([head(2, BigInt(bytes.length)), bytes]);
}

/** Major type 4: an array of already-encoded items. */
export function cborArray(items: readonly Uint8Array[]): Uint8Array {
  return join([head(4, BigInt(items.length)), ...items]);
}

/** Major type 5: a map of already-encoded (key, value) pairs, in the order given. */
export function cborMap(entries: readonly (readonly [Uint8Array, Uint8Array])[]): Uint8Array {
  return join([head(5, BigInt(entries.length)), ...entries.flat()]);
}

/** Major type 6: a tag over an already-encoded item. */
export function cborTag(tag: number, item: Uint8Array): Uint8Array {
  return join([head(6, BigInt(tag)), item]);
}

export const CBOR_TRUE = Uint8Array.of(0xf5);
export const CBOR_NULL = Uint8Array.of(0xf6);

export type CborItem =
  | { type: 'uint'; value: bigint }
  | { type: 'nint'; value: bigint }
  | { type: 'bytes'; value: Uint8Array }
  | { type: 'text'; value: string }
  | { type: 'array'; items: CborItem[] }
  | { type: 'map'; entries: [CborItem, CborItem][] }
  | { type: 'tag'; tag: bigint; item: CborItem }
  /** 20 false, 21 true, 22 null, 23 undefined. */
  | { type: 'simple'; value: number };

/** Decode exactly one item spanning all of `bytes`; throws on anything else. */
export function cborDecode(bytes: Uint8Array): CborItem {
  let at = 0;

  const take = (n: number): Uint8Array => {
    if (n > bytes.length - at) throw new Error('CBOR: truncated');
    const out = bytes.subarray(at, at + n);
    at += n;
    return out;
  };

  const argument = (info: number): bigint => {
    if (info < 24) return BigInt(info);
    const wide = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
    // 28–30 are reserved and 31 is an indefinite length: neither is anything the wallet reads.
    if (wide === 0) throw new Error('CBOR: unsupported length');
    let n = 0n;
    for (const b of take(wide)) n = (n << 8n) | BigInt(b);
    return n;
  };

  const length = (info: number): number => {
    const n = argument(info);
    // A length beyond what is left can only be a lie; checking it here keeps an attacker's
    // 2^64-item array from allocating anything.
    if (n > BigInt(bytes.length - at)) throw new Error('CBOR: truncated');
    return Number(n);
  };

  const item = (depth: number): CborItem => {
    if (depth > MAX_DEPTH) throw new Error('CBOR: nested too deep');
    const [initial] = take(1);
    const major = initial >> 5;
    const info = initial & 0x1f;
    switch (major) {
      case 0:
        return { type: 'uint', value: argument(info) };
      case 1:
        return { type: 'nint', value: -1n - argument(info) };
      case 2:
        return { type: 'bytes', value: Uint8Array.from(take(length(info))) };
      case 3:
        return { type: 'text', value: new TextDecoder('utf-8', { fatal: true }).decode(take(length(info))) };
      case 4: {
        const n = length(info);
        const items: CborItem[] = [];
        for (let i = 0; i < n; i++) items.push(item(depth + 1));
        return { type: 'array', items };
      }
      case 5: {
        const n = length(info);
        const entries: [CborItem, CborItem][] = [];
        for (let i = 0; i < n; i++) entries.push([item(depth + 1), item(depth + 1)]);
        return { type: 'map', entries };
      }
      case 6:
        return { type: 'tag', tag: argument(info), item: item(depth + 1) };
      default:
        // Major 7: only the simple values; floats and the break code are not read here.
        if (info >= 20 && info <= 23) return { type: 'simple', value: info };
        throw new Error('CBOR: unsupported simple value');
    }
  };

  const out = item(0);
  if (at !== bytes.length) throw new Error('CBOR: trailing bytes');
  return out;
}
