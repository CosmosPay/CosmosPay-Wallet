/**
 * TON's cells and bags of cells, as far as the wallet's own transfers need them. Everything TON
 * signs, sends or hashes is a tree of cells — up to 1023 bits and four references each — and an
 * address, a message hash or a signed payload is a cell's representation hash. A transfer is
 * written as cells and sent as a bag of cells (BOC), so both are built here by hand rather than
 * pulled in with `@ton/core`.
 *
 * Only ordinary cells (level 0) are built or read: a wallet message, its StateInit and the v4R2
 * code have no exotic ones (pruned branches, library or Merkle cells), and a BOC that holds one is
 * refused rather than hashed wrong.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export interface TonCell {
  /** The data bits, most significant first; any bits past `bits` in the last byte are zero. */
  readonly data: Uint8Array;
  readonly bits: number;
  readonly refs: readonly TonCell[];
  /** The representation hash (`cell_hash`): what an address, a signature or a message id is of. */
  readonly hash: Uint8Array;
  /** The longest path to a leaf (`cell_depth`); a child's depth is part of its parent's hash. */
  readonly depth: number;
}

const MAX_BITS = 1023;
const MAX_REFS = 4;
const BOC_MAGIC = 0xb5ee9c72;

/**
 * The data as a cell stores it: whole bytes, and when the bits do not end on one, a single 1 bit
 * then zeros (the completion tag) — so 0b1 and 0b10 are different cells.
 */
function padded(data: Uint8Array, bits: number): Uint8Array {
  const out = data.slice(0, Math.ceil(bits / 8));
  if (bits % 8) out[out.length - 1] |= 0x80 >> bits % 8;
  return out;
}

/** d1 (the reference count; ordinary, level 0) and d2 (the data's length in half-bytes, rounded up). */
function descriptors(cell: { bits: number; refs: readonly unknown[] }): [number, number] {
  return [cell.refs.length, Math.ceil(cell.bits / 8) + Math.floor(cell.bits / 8)];
}

function makeCell(data: Uint8Array, bits: number, refs: readonly TonCell[]): TonCell {
  const own = data.slice(0, Math.ceil(bits / 8));
  if (bits % 8) own[own.length - 1] &= 0xff00 >> bits % 8;
  // The representation: descriptors, padded data, then every child's depth and every child's hash.
  const body = padded(own, bits);
  const repr = new Uint8Array(2 + body.length + refs.length * 34);
  [repr[0], repr[1]] = descriptors({ bits, refs });
  repr.set(body, 2);
  let at = 2 + body.length;
  for (const r of refs) {
    repr[at++] = r.depth >> 8;
    repr[at++] = r.depth & 0xff;
  }
  for (const r of refs) {
    repr.set(r.hash, at);
    at += 32;
  }
  const depth = refs.length ? 1 + Math.max(...refs.map((r) => r.depth)) : 0;
  return { data: own, bits, refs: [...refs], hash: sha256(repr), depth };
}

/** Writes one cell, field by field, in the order the TL-B scheme reads it. */
export class TonCellBuilder {
  private data = new Uint8Array(Math.ceil(MAX_BITS / 8));
  private bits = 0;
  private readonly refs: TonCell[] = [];

  bit(on: boolean): this {
    if (this.bits >= MAX_BITS) throw new Error('TON cell overflow: more than 1023 bits');
    if (on) this.data[this.bits >> 3] |= 0x80 >> (this.bits & 7);
    this.bits++;
    return this;
  }

  /** An unsigned integer in `width` bits, big-endian. */
  uint(value: bigint | number, width: number): this {
    const v = BigInt(value);
    if (v < 0n || v >> BigInt(width) !== 0n) throw new Error(`TON cell: ${v} does not fit ${width} unsigned bits`);
    for (let i = width - 1; i >= 0; i--) this.bit(((v >> BigInt(i)) & 1n) === 1n);
    return this;
  }

  /** A signed integer in `width` bits, two's complement (a workchain id is an int8). */
  int(value: number, width: number): this {
    const v = BigInt(value);
    const half = 1n << BigInt(width - 1);
    if (v < -half || v >= half) throw new Error(`TON cell: ${v} does not fit ${width} signed bits`);
    return this.uint(v < 0n ? (half << 1n) + v : v, width);
  }

  bytes(bytes: Uint8Array): this {
    for (const b of bytes) this.uint(b, 8);
    return this;
  }

  /** The first `bits` bits of `data`: another cell's contents, copied as they are. */
  slice(data: Uint8Array, bits: number): this {
    for (let i = 0; i < bits; i++) this.bit((data[i >> 3] & (0x80 >> (i & 7))) !== 0);
    return this;
  }

  /**
   * `Grams` (VarUInteger 16): a 4-bit byte count, then the amount in that many bytes — zero is
   * the count 0 alone. Nanotons, an integer all the way.
   */
  coins(amount: bigint): this {
    if (amount < 0n || amount >> 120n !== 0n) throw new Error(`TON cell: ${amount} is not an amount of nanotons`);
    let len = 0;
    while (amount >> BigInt(len * 8) !== 0n) len++;
    return this.uint(len, 4).uint(amount, len * 8);
  }

  /** `addr_std$10`, no anycast: the workchain (int8) and the account id (256 bits). */
  address(workchain: number, account: Uint8Array): this {
    if (account.length !== 32) throw new Error('TON cell: an account id is 32 bytes');
    return this.uint(0b10, 2).bit(false).int(workchain, 8).bytes(account);
  }

  ref(cell: TonCell): this {
    if (this.refs.length >= MAX_REFS) throw new Error('TON cell overflow: more than four references');
    this.refs.push(cell);
    return this;
  }

  /** Every bit and reference of `cell`, as if written here. */
  append(cell: TonCell): this {
    this.slice(cell.data, cell.bits);
    for (const r of cell.refs) this.ref(r);
    return this;
  }

  end(): TonCell {
    return makeCell(this.data, this.bits, this.refs);
  }
}

/* ------------------------------- CRC32C ------------------------------- */

/** CRC-32C (Castagnoli, reflected 0x82F63B78): the checksum a BOC ends with. */
const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC32C_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------------------------- bag of cells ---------------------------- */

/** The fewest bytes that hold `n` (at least one). */
function widthOf(n: number): number {
  let w = 1;
  while (n >= 2 ** (8 * w)) w++;
  return w;
}

function writeUint(out: number[], value: number, width: number): void {
  for (let i = width - 1; i >= 0; i--) out.push(Math.floor(value / 2 ** (8 * i)) & 0xff);
}

/**
 * `serialized_boc#b5ee9c72` with one root, no index, a CRC32C — what toncenter and every TON
 * library write. A cell shared by two parents is written once (cells are identified by their
 * hash), and every cell comes before the cells it refers to: the reverse of a depth-first
 * post-order, which a node requires of the indices.
 */
export function serializeBoc(root: TonCell): Uint8Array {
  const order: TonCell[] = [];
  const seen = new Set<string>();
  const visit = (cell: TonCell) => {
    const key = bytesToHex(cell.hash);
    if (seen.has(key)) return;
    seen.add(key);
    for (const r of cell.refs) visit(r);
    order.push(cell);
  };
  visit(root);
  order.reverse();
  const index = new Map(order.map((cell, i) => [bytesToHex(cell.hash), i]));

  const size = widthOf(order.length);
  const cells: number[] = [];
  for (const cell of order) {
    cells.push(...descriptors(cell), ...padded(cell.data, cell.bits));
    for (const r of cell.refs) writeUint(cells, index.get(bytesToHex(r.hash))!, size);
  }
  const offBytes = widthOf(cells.length);

  const out: number[] = [];
  writeUint(out, BOC_MAGIC, 4);
  out.push(0b0100_0000 | size, offBytes); // has_idx 0, has_crc32c 1, has_cache_bits 0, flags 0
  writeUint(out, order.length, size); // cells
  writeUint(out, 1, size); // roots
  writeUint(out, 0, size); // absent
  writeUint(out, cells.length, offBytes);
  writeUint(out, 0, size); // the root is the first cell
  out.push(...cells);
  const crc = crc32c(Uint8Array.from(out));
  out.push(crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24); // little-endian
  return Uint8Array.from(out);
}

/** The roots of a `serialized_boc#b5ee9c72`. Anything malformed, or any exotic cell, throws. */
export function parseBoc(bytes: Uint8Array): TonCell[] {
  let at = 0;
  const need = (n: number) => {
    if (at + n > bytes.length) throw new Error('TON BOC: truncated');
  };
  const read = (width: number): number => {
    need(width);
    let v = 0;
    for (let i = 0; i < width; i++) v = v * 256 + bytes[at++];
    return v;
  };
  if (read(4) !== BOC_MAGIC) throw new Error('TON BOC: not a serialized_boc');
  const flags = read(1);
  const hasIndex = (flags & 0x80) !== 0;
  const hasCrc = (flags & 0x40) !== 0;
  const size = flags & 0x07;
  const offBytes = read(1);
  if (size < 1 || size > 4 || offBytes < 1 || offBytes > 8) throw new Error('TON BOC: bad sizes');
  const count = read(size);
  const rootCount = read(size);
  const absent = read(size);
  const total = read(offBytes);
  if (rootCount < 1 || absent !== 0 || rootCount > count) throw new Error('TON BOC: bad cell counts');
  const roots = Array.from({ length: rootCount }, () => read(size));
  if (hasIndex) {
    need(count * offBytes);
    at += count * offBytes;
  }
  const cellsEnd = at + total;
  need(total + (hasCrc ? 4 : 0));
  if (hasCrc) {
    const want = bytes[cellsEnd] | (bytes[cellsEnd + 1] << 8) | (bytes[cellsEnd + 2] << 16) | (bytes[cellsEnd + 3] << 24);
    if (crc32c(bytes.subarray(0, cellsEnd)) !== want >>> 0) throw new Error('TON BOC: CRC32C mismatch');
  }
  if (cellsEnd + (hasCrc ? 4 : 0) !== bytes.length) throw new Error('TON BOC: trailing bytes');

  const raw: { data: Uint8Array; bits: number; refs: number[] }[] = [];
  for (let i = 0; i < count; i++) {
    const d1 = read(1);
    const d2 = read(1);
    if (d1 & 0b1110_1000) throw new Error('TON BOC: exotic or levelled cells are not supported');
    const refCount = d1 & 0x07;
    if (refCount > MAX_REFS) throw new Error('TON BOC: more than four references');
    if (d1 & 0x10) at += 34; // stored hash and depth (level 0): recomputed below, not trusted
    const len = Math.ceil(d2 / 2);
    need(len);
    const data = bytes.slice(at, at + len);
    at += len;
    let bits = len * 8;
    if (d2 % 2) {
      // A partial last byte ends in the completion tag: the lowest set bit is not data.
      const last = data[len - 1];
      if (last === 0) throw new Error('TON BOC: missing completion tag');
      let zeros = 0;
      while (((last >> zeros) & 1) === 0) zeros++;
      bits -= zeros + 1;
    }
    const refs = Array.from({ length: refCount }, () => read(size));
    if (refs.some((r) => r <= i || r >= count)) throw new Error('TON BOC: a reference that is not to a later cell');
    raw.push({ data, bits, refs });
  }
  if (at !== cellsEnd) throw new Error('TON BOC: cell data length mismatch');

  const cells: TonCell[] = new Array(count);
  for (let i = count - 1; i >= 0; i--) {
    const { data, bits, refs } = raw[i];
    cells[i] = makeCell(data, bits, refs.map((r) => cells[r]));
  }
  return roots.map((r) => {
    if (r >= count) throw new Error('TON BOC: root out of range');
    return cells[r];
  });
}
