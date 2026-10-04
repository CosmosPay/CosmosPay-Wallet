/**
 * Solana transactions, as far as this wallet signs them.
 *
 * Two sources, two kinds of trust:
 *
 *   - A Jupiter swap the gateway built. The wallet did not write it and cannot read a
 *     route's instructions, so what it checks is the transaction's EFFECT: the gateway's
 *     transaction is simulated with the wallet's own accounts in view, and
 *     `checkSwapEffects` decides from the before/after balances whether it moves only
 *     what the user confirmed (see there). Plus the shape: one signer, and it is us.
 *   - A deposit the wallet builds itself (SOL or an SPL `transferChecked` to a NEAR
 *     Intents address). Nothing from the gateway goes into it but the address and the
 *     amount, and both are checked against the screen before it is built.
 *
 * No `@solana/web3.js`: the wire format is small, and the wallet already carries
 * ed25519 and base58.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/** The wrapped-SOL mint: SOL held as an SPL token, 1:1 with lamports. */
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Base58 → 32 bytes, or a throw: every Solana address is exactly that. */
export function solanaKey(address: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(address);
  } catch {
    throw new Error(`"${address}" is not a Solana address`);
  }
  if (bytes.length !== 32) throw new Error(`"${address}" is not a Solana address`);
  return bytes;
}

export const isSolanaAddress = (v: string): boolean => {
  try {
    solanaKey(v);
    return true;
  } catch {
    return false;
  }
};

/* ------------------------------ wire format ------------------------------ */

function readShortVec(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 3; i += 1) {
    if (at + i >= bytes.length) throw new Error('shortvec runs past the input');
    const byte = bytes[at + i];
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return [value, at + i + 1];
  }
  throw new Error('shortvec is longer than 3 bytes');
}

function shortVec(n: number): Uint8Array {
  const out: number[] = [];
  let v = n;
  for (;;) {
    const byte = v & 0x7f;
    v >>= 7;
    if (v === 0) {
      out.push(byte);
      return Uint8Array.from(out);
    }
    out.push(byte | 0x80);
  }
}

export interface ParsedSolanaTx {
  signatures: Uint8Array[];
  /** Offset of the first signature slot in the wire bytes. */
  sigStart: number;
  message: Uint8Array;
  /** The first static keys, base58: the signers, in signature order. */
  signers: string[];
}

/** Signatures, the signed message and its signers — legacy or v0. */
export function parseSolanaTx(bytes: Uint8Array): ParsedSolanaTx {
  const [count, sigStart] = readShortVec(bytes, 0);
  const sigEnd = sigStart + count * 64;
  if (count === 0 || sigEnd > bytes.length) throw new Error('no room for the signatures');
  const signatures = Array.from({ length: count }, (_, i) => bytes.subarray(sigStart + i * 64, sigStart + (i + 1) * 64));
  const message = bytes.subarray(sigEnd);
  let at = 0;
  if (message[at] & 0x80) {
    if (message[at] !== 0x80) throw new Error('unsupported message version');
    at += 1;
  }
  const required = message[at];
  const [keyCount, keysStart] = readShortVec(message, at + 3);
  if (required !== count || required > keyCount || keysStart + keyCount * 32 > message.length) {
    throw new Error('signature count does not match the message header');
  }
  const signers = Array.from({ length: required }, (_, i) =>
    base58.encode(message.subarray(keysStart + i * 32, keysStart + (i + 1) * 32)),
  );
  return { signatures, sigStart, message, signers };
}

/** A v0 message's reference into an address lookup table. */
export interface TableLookup {
  table: string;
  writable: number[];
  readonly: number[];
}

/**
 * What a message may write to: its writable static keys, plus the lookup-table entries
 * it loads as writable (v0). An account outside this set cannot change, whatever the
 * instructions say — the runtime refuses the write — which is what lets the swap check
 * look only at these.
 */
export function messageAccounts(message: Uint8Array): { writable: string[]; lookups: TableLookup[] } {
  let at = 0;
  const v0 = (message[0] & 0x80) !== 0;
  if (v0) at += 1;
  const [required, readonlySigned, readonlyUnsigned] = [message[at], message[at + 1], message[at + 2]];
  const [keyCount, keysStart] = readShortVec(message, at + 3);
  const key = (i: number) => base58.encode(message.subarray(keysStart + i * 32, keysStart + (i + 1) * 32));
  const writable: string[] = [];
  for (let i = 0; i < keyCount; i += 1) {
    const isWritable = i < required ? i < required - readonlySigned : i < keyCount - readonlyUnsigned;
    if (isWritable) writable.push(key(i));
  }
  at = keysStart + keyCount * 32 + 32; // keys, then the blockhash
  const [ixCount, ixStart] = readShortVec(message, at);
  at = ixStart;
  for (let i = 0; i < ixCount; i += 1) {
    at += 1; // program index
    const [accounts, afterAccounts] = readShortVec(message, at);
    const [dataLen, afterLen] = readShortVec(message, afterAccounts + accounts);
    at = afterLen + dataLen;
  }
  const lookups: TableLookup[] = [];
  if (v0) {
    const [count, start] = readShortVec(message, at);
    at = start;
    for (let i = 0; i < count; i += 1) {
      const table = base58.encode(message.subarray(at, at + 32));
      const [w, wStart] = readShortVec(message, at + 32);
      const writableIdx = [...message.subarray(wStart, wStart + w)];
      const [r, rStart] = readShortVec(message, wStart + w);
      const readonlyIdx = [...message.subarray(rStart, rStart + r)];
      at = rStart + r;
      lookups.push({ table, writable: writableIdx, readonly: readonlyIdx });
    }
  }
  if (at > message.length) throw new Error('message runs past its end');
  return { writable, lookups };
}

/** The addresses stored in a lookup table account (after its 56-byte header). */
export function lookupTableAddresses(data: Uint8Array): string[] {
  const out: string[] = [];
  for (let at = 56; at + 32 <= data.length; at += 32) out.push(base58.encode(data.subarray(at, at + 32)));
  return out;
}

/**
 * Sign a transaction whose ONLY signer is `owner` (the fee payer too). Anything with a
 * second signer is refused: this wallet cannot vouch for a key it does not hold, and a
 * swap never needs one. Returns the signed wire bytes and the transaction id.
 */
export function signSolanaTx(wire: Uint8Array, secret: Uint8Array, owner: string): { signed: Uint8Array; id: string } {
  const tx = parseSolanaTx(wire);
  if (tx.signers.length !== 1 || tx.signers[0] !== owner) {
    throw new Error('The transaction must be signed by this wallet alone');
  }
  const signature = ed25519.sign(tx.message, secret);
  const signed = Uint8Array.from(wire);
  signed.set(signature, tx.sigStart);
  return { signed, id: base58.encode(signature) };
}

/* ---------------------------- token accounts ----------------------------- */

function isOnCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(bytes);
    return true;
  } catch {
    return false;
  }
}

/** `PublicKey.findProgramAddressSync`: the first bump from 255 whose hash is off-curve. */
export function findProgramAddress(seeds: Uint8Array[], programId: string): string {
  const program = solanaKey(programId);
  const marker = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = sha256(concatBytes(...seeds, Uint8Array.of(bump), program, marker));
    if (!isOnCurve(hash)) return base58.encode(hash);
  }
  throw new Error('no viable bump for these seeds');
}

/** The associated token account of `owner` for `mint` under `tokenProgram`. */
export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string): string {
  return findProgramAddress([solanaKey(owner), solanaKey(tokenProgram), solanaKey(mint)], ASSOCIATED_TOKEN_PROGRAM_ID);
}

/** An SPL token account (both programs share the first 165 bytes). */
export interface TokenAccount {
  mint: string;
  owner: string;
  amount: bigint;
  /** `COption` tags: whether a delegate / close authority is set. */
  hasDelegate: boolean;
  hasCloseAuthority: boolean;
}

const u64le = (b: Uint8Array, at: number): bigint => {
  let v = 0n;
  for (let i = 7; i >= 0; i -= 1) v = (v << 8n) | BigInt(b[at + i]);
  return v;
};

export function decodeTokenAccount(data: Uint8Array): TokenAccount | null {
  if (data.length < 165) return null;
  return {
    mint: base58.encode(data.subarray(0, 32)),
    owner: base58.encode(data.subarray(32, 64)),
    amount: u64le(data, 64),
    hasDelegate: data[72] !== 0,
    hasCloseAuthority: data[129] !== 0,
  };
}

/* --------------------------- effect of a swap ---------------------------- */

/** One account before or after a simulation; null when it does not exist. */
export type AccountState = { lamports: bigint; owner: string; data: Uint8Array } | null;

/** Why a Solana swap was refused before signing (an i18n-free code the store maps). */
export type SolanaSwapRefusal = 'authority' | 'drain' | 'short';

export interface SwapEffectRules {
  owner: string;
  /** What leaves: `native` (lamports) or a mint, and at most how much. */
  sell: { asset: string; amount: bigint };
  /** What must arrive: `native` or a mint, and at least how much. */
  buy: { asset: string; minimum: bigint };
  /** Lamports the transaction may spend on fees and rent besides a SOL sale. */
  lamportAllowance: bigint;
}

/**
 * Decide from a simulation whether a swap does only what the user confirmed:
 *
 *   - the wallet's own account stays a System account (no `Assign`);
 *   - every token account the wallet owned stays owned by it and gains no delegate and
 *     no close authority; one closed must have been empty — except wrapped SOL, below;
 *   - no token balance falls except the one being sold, and that by at most the amount;
 *   - SOL falls by at most the SOL sold plus the fee/rent allowance;
 *   - what is bought rises by at least the quote's minimum.
 *
 * Wrapped SOL counts as SOL: the wallet's lamports plus those of its wSOL accounts. A
 * swap unwraps by CLOSING the wSOL account into the wallet, which is a large token
 * "loss" and an equal lamport gain — and a close into anyone else's account shows up
 * as the SOL loss it is.
 *
 * `pre` and `post` are keyed by address and cover the wallet and every account of ours
 * the transaction may write to (no other can change). Returns null when it may be signed.
 */
export function checkSwapEffects(
  rules: SwapEffectRules,
  pre: Map<string, AccountState>,
  post: Map<string, AccountState>,
): SolanaSwapRefusal | null {
  const walletPost = post.get(rules.owner);
  if (!walletPost || walletPost.owner !== SYSTEM_PROGRAM_ID) return 'authority';
  let nativeBefore = pre.get(rules.owner)?.lamports ?? 0n;
  let nativeAfter = walletPost.lamports;

  const bought: Record<string, bigint> = {};
  for (const [address, before] of pre) {
    if (address === rules.owner || !before) continue;
    const tokenBefore = decodeTokenAccount(before.data);
    if (!tokenBefore || tokenBefore.owner !== rules.owner) continue;
    const wrapped = tokenBefore.mint === WRAPPED_SOL_MINT;
    const after = post.get(address);
    const tokenAfter = after ? decodeTokenAccount(after.data) : null;
    if (wrapped) nativeBefore += before.lamports;
    if (!tokenAfter) {
      if (!wrapped && tokenBefore.amount !== 0n) return 'drain';
      continue;
    }
    if (
      tokenAfter.owner !== rules.owner ||
      tokenAfter.mint !== tokenBefore.mint ||
      (tokenAfter.hasDelegate && !tokenBefore.hasDelegate) ||
      (tokenAfter.hasCloseAuthority && !tokenBefore.hasCloseAuthority)
    ) {
      return 'authority';
    }
    if (wrapped) {
      nativeAfter += after!.lamports;
      continue;
    }
    const delta = tokenAfter.amount - tokenBefore.amount;
    const floor = tokenBefore.mint === rules.sell.asset ? -rules.sell.amount : 0n;
    if (delta < floor) return 'drain';
    bought[tokenBefore.mint] = (bought[tokenBefore.mint] ?? 0n) + delta;
  }
  // Token accounts the swap opened (the output's ATA, typically).
  for (const [address, after] of post) {
    if (address === rules.owner || !after || pre.get(address)) continue;
    const token = decodeTokenAccount(after.data);
    if (!token || token.owner !== rules.owner) continue;
    if (token.hasDelegate || token.hasCloseAuthority) return 'authority';
    if (token.mint === WRAPPED_SOL_MINT) nativeAfter += after.lamports;
    else bought[token.mint] = (bought[token.mint] ?? 0n) + token.amount;
  }

  const nativeDelta = nativeAfter - nativeBefore;
  const nativeFloor = -(rules.lamportAllowance + (rules.sell.asset === 'native' ? rules.sell.amount : 0n));
  if (nativeDelta < nativeFloor) return 'drain';
  const received = rules.buy.asset === 'native' ? nativeDelta + rules.lamportAllowance : bought[rules.buy.asset] ?? 0n;
  if (received < rules.buy.minimum) return 'short';
  return null;
}

/* ------------------------------ deposits -------------------------------- */

interface AccountMeta {
  key: string;
  signer: boolean;
  writable: boolean;
}

interface Instruction {
  program: string;
  accounts: AccountMeta[];
  data: Uint8Array;
}

const u32le = (n: number) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
const u64leBytes = (n: bigint) => Uint8Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(8 * i)) & 0xffn));

/**
 * A legacy message: keys ordered writable signers, readonly signers, writable
 * non-signers, readonly non-signers (the fee payer first), then the instructions by
 * index. Returned as an UNSIGNED transaction (one zeroed signature slot).
 */
export function compileLegacyTx(payer: string, recentBlockhash: string, instructions: Instruction[]): Uint8Array {
  const metas = new Map<string, AccountMeta>([[payer, { key: payer, signer: true, writable: true }]]);
  for (const ix of instructions) {
    for (const a of [...ix.accounts, { key: ix.program, signer: false, writable: false }]) {
      const cur = metas.get(a.key);
      metas.set(a.key, cur ? { key: a.key, signer: cur.signer || a.signer, writable: cur.writable || a.writable } : { ...a });
    }
  }
  const rest = [...metas.values()].filter((m) => m.key !== payer);
  const rank = (m: AccountMeta) => (m.signer ? (m.writable ? 0 : 1) : m.writable ? 2 : 3);
  const ordered = [metas.get(payer)!, ...rest.sort((a, b) => rank(a) - rank(b))];
  const index = new Map(ordered.map((m, i) => [m.key, i]));
  const signers = ordered.filter((m) => m.signer);
  const header = Uint8Array.of(
    signers.length,
    signers.filter((m) => !m.writable).length,
    ordered.filter((m) => !m.signer && !m.writable).length,
  );
  const message = concatBytes(
    header,
    shortVec(ordered.length),
    ...ordered.map((m) => solanaKey(m.key)),
    solanaKey(recentBlockhash),
    shortVec(instructions.length),
    ...instructions.map((ix) =>
      concatBytes(
        Uint8Array.of(index.get(ix.program)!),
        shortVec(ix.accounts.length),
        Uint8Array.from(ix.accounts.map((a) => index.get(a.key)!)),
        shortVec(ix.data.length),
        ix.data,
      ),
    ),
  );
  return concatBytes(shortVec(signers.length), new Uint8Array(64 * signers.length), message);
}

/** A SOL transfer from `from` to `to`, unsigned. */
export function solTransferTx(from: string, to: string, lamports: bigint, recentBlockhash: string): Uint8Array {
  return compileLegacyTx(from, recentBlockhash, [
    {
      program: SYSTEM_PROGRAM_ID,
      accounts: [
        { key: from, signer: true, writable: true },
        { key: to, signer: false, writable: true },
      ],
      data: concatBytes(u32le(2), u64leBytes(lamports)),
    },
  ]);
}

/**
 * An SPL transfer of `amount` of `mint` from `owner`'s associated account to `to`'s,
 * opening that one first if it does not exist (idempotent, paid by `owner`). Unsigned.
 */
export function splTransferTx(p: {
  owner: string;
  to: string;
  mint: string;
  decimals: number;
  amount: bigint;
  tokenProgram: string;
  recentBlockhash: string;
}): Uint8Array {
  const source = associatedTokenAddress(p.owner, p.mint, p.tokenProgram);
  const dest = associatedTokenAddress(p.to, p.mint, p.tokenProgram);
  return compileLegacyTx(p.owner, p.recentBlockhash, [
    {
      program: ASSOCIATED_TOKEN_PROGRAM_ID,
      accounts: [
        { key: p.owner, signer: true, writable: true },
        { key: dest, signer: false, writable: true },
        { key: p.to, signer: false, writable: false },
        { key: p.mint, signer: false, writable: false },
        { key: SYSTEM_PROGRAM_ID, signer: false, writable: false },
        { key: p.tokenProgram, signer: false, writable: false },
      ],
      data: Uint8Array.of(1), // CreateIdempotent
    },
    {
      program: p.tokenProgram,
      accounts: [
        { key: source, signer: false, writable: true },
        { key: p.mint, signer: false, writable: false },
        { key: dest, signer: false, writable: true },
        { key: p.owner, signer: true, writable: false },
      ],
      data: concatBytes(Uint8Array.of(12), u64leBytes(p.amount), Uint8Array.of(p.decimals)), // TransferChecked
    },
  ]);
}
