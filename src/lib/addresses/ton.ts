/**
 * The TON address of an ed25519 public key: the standard wallet v4R2 contract it would deploy,
 * as Trust Wallet Core derives it — workchain 0, subwallet 698983191, user-friendly,
 * NON-bounceable (`UQ…`), url-safe base64.
 *
 * Non-bounceable because the wallet is not deployed until it first sends: a bounceable
 * transfer to an undeployed account bounces back to the sender instead of arriving.
 *
 * A TON address is the hash of the contract's initial state, a tree of cells. Only two cells
 * are ours (the wallet's data and the state that points at it); the wallet's code is fixed,
 * so its hash and depth are constants rather than bytecode for `@ton/core` to rebuild them
 * from. Both were read from `@ton/ton`'s `WalletContractV4`.
 */
import { base64url } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes } from '@noble/hashes/utils.js';

const V4R2_CODE_HASH = hexToBytes('feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0');
const V4R2_CODE_DEPTH = 7;
/** wallet_id = 698983191 + workchain. */
const V4R2_SUBWALLET_ID = 698983191;
/** User-friendly tag: 0x11 (bounceable) | 0x40 (non-bounceable flag). */
const TAG_NON_BOUNCEABLE = 0x51;

/** CRC-16/XMODEM, the user-friendly form's checksum. */
function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * The v4R2 wallet of `publicKey` on workchain 0. Each cell's hash is SHA-256 of its
 * descriptors (refs; data length), its data padded with a 1 bit, then its children's
 * depths and hashes.
 */
export function tonWalletAddress(publicKey: Uint8Array): string {
  // Data cell, 321 bits and no refs: seqno 0 (32) ‖ subwallet (32) ‖ public key (256) ‖ an
  // empty plugin dictionary (1 bit, 0). d2 = ceil(321 / 8) + floor(321 / 8) = 81.
  const data = new Uint8Array(2 + 41);
  data[1] = 81;
  new DataView(data.buffer).setUint32(6, V4R2_SUBWALLET_ID);
  data.set(publicKey, 10);
  data[42] = 0b0100_0000;
  const dataHash = sha256(data);

  // StateInit, 5 bits and two refs: no split_depth, no special, code ✓, data ✓, no library
  // (0 0 1 1 0, then the pad bit). The data cell has depth 0.
  const init = new Uint8Array(3 + 4 + 64);
  init[0] = 2;
  init[1] = 1;
  init[2] = 0b0011_0100;
  new DataView(init.buffer).setUint16(3, V4R2_CODE_DEPTH);
  init.set(V4R2_CODE_HASH, 7);
  init.set(dataHash, 39);

  const raw = new Uint8Array(36);
  raw[0] = TAG_NON_BOUNCEABLE;
  raw[1] = 0; // workchain 0
  raw.set(sha256(init), 2);
  new DataView(raw.buffer).setUint16(34, crc16(raw.subarray(0, 34)));
  return base64url.encode(raw);
}
