/**
 * The Cardano Shelley base address (`addr1…`) of a recovery phrase, as Trust Wallet Core derives
 * it: CIP-1852 paths, the Icarus master key, BIP32-Ed25519 child keys.
 *
 *   payment  m/1852'/1815'/0'/0/0
 *   stake    m/1852'/1815'/0'/2/0
 *   address  bech32 "addr" of 0x01 ‖ blake2b-224(payment key) ‖ blake2b-224(stake key)
 *
 * Cardano does not use the BIP-39 seed: the Icarus master key comes from the phrase's ENTROPY
 * (PBKDF2-HMAC-SHA512, 4096 rounds, empty passphrase), and its extended keys are 64 bytes
 * (kL ‖ kR) plus a chain code, so neither `@scure/bip32` nor SLIP-10 applies.
 */
import { bech32 } from '@scure/base';
import { sha512 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToNumberLE } from '@noble/curves/utils.js';

const HARDENED = 0x80000000;
export const CARDANO_PAYMENT_PATH = [1852 + HARDENED, 1815 + HARDENED, HARDENED, 0, 0] as const;
export const CARDANO_STAKE_PATH = [1852 + HARDENED, 1815 + HARDENED, HARDENED, 2, 0] as const;
/** Base address (payment key hash, stake key hash) on mainnet. */
const BASE_ADDRESS_MAINNET = 0x01;

/** kL · B. kL is used as the scalar itself — no hashing, unlike an ed25519 seed. */
function publicKeyOf(kL: Uint8Array): Uint8Array {
  return ed25519.Point.BASE.multiply(bytesToNumberLE(kL) % ed25519.Point.Fn.ORDER).toBytes();
}

/** The Icarus root: kL ‖ kR ‖ chain code, with kL clamped. */
function icarusRoot(entropy: Uint8Array): Uint8Array {
  const xprv = pbkdf2(sha512, new Uint8Array(0), entropy, { c: 4096, dkLen: 96 });
  xprv[0] &= 0b1111_1000;
  xprv[31] &= 0b0001_1111;
  xprv[31] |= 0b0100_0000;
  return xprv;
}

/** BIP32-Ed25519 child (derivation scheme V2): kL' = kL + 8·ZL[0..28), kR' = kR + ZR, little-endian. */
function deriveChild(xprv: Uint8Array, index: number): Uint8Array {
  const kL = xprv.subarray(0, 32);
  const kR = xprv.subarray(32, 64);
  const chainCode = xprv.subarray(64, 96);
  const i = new Uint8Array(4);
  new DataView(i.buffer).setUint32(0, index, true);
  const [zTag, cTag, body] =
    index >= HARDENED ? [0x00, 0x01, concatBytes(kL, kR)] : [0x02, 0x03, publicKeyOf(kL)];
  const z = hmac(sha512, chainCode, concatBytes(new Uint8Array([zTag]), body, i));
  const c = hmac(sha512, chainCode, concatBytes(new Uint8Array([cTag]), body, i));

  const child = new Uint8Array(96);
  let carry = 0;
  for (let b = 0; b < 32; b++) {
    const r = kL[b] + (b < 28 ? z[b] << 3 : 0) + carry;
    child[b] = r & 0xff;
    carry = r >> 8;
  }
  carry = 0;
  for (let b = 0; b < 32; b++) {
    const r = kR[b] + z[32 + b] + carry;
    child[32 + b] = r & 0xff;
    carry = r >> 8;
  }
  child.set(c.subarray(32, 64), 64);
  body.fill(0);
  z.fill(0);
  c.fill(0);
  return child;
}

function publicKeyAt(root: Uint8Array, path: readonly number[]): Uint8Array {
  let key = root;
  for (const index of path) {
    const next = deriveChild(key, index);
    if (key !== root) key.fill(0);
    key = next;
  }
  const pub = publicKeyOf(key.subarray(0, 32));
  key.fill(0);
  return pub;
}

/** The base address of a phrase's BIP-39 entropy. */
export function cardanoBaseAddress(entropy: Uint8Array): string {
  const root = icarusRoot(entropy);
  try {
    const payment = blake2b(publicKeyAt(root, CARDANO_PAYMENT_PATH), { dkLen: 28 });
    const stake = blake2b(publicKeyAt(root, CARDANO_STAKE_PATH), { dkLen: 28 });
    const bytes = concatBytes(new Uint8Array([BASE_ADDRESS_MAINNET]), payment, stake);
    // 57 bytes are 103 characters: past bech32's 90-character default limit, as CIP-19 allows.
    return bech32.encode('addr', bech32.toWords(bytes), false);
  } finally {
    root.fill(0);
  }
}
