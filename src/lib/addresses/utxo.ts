/**
 * The Bitcoin-family addresses of one compressed secp256k1 public key, spelled the way Trust
 * Wallet Core spells each network's default account (`lib/chainAddresses.ts` picks the paths):
 *
 *   btc   P2WPKH, bech32 `bc1q…`
 *   ltc   P2WPKH, bech32 `ltc1q…`
 *   doge  P2PKH, base58check, version 0x1e → `D…`
 *   dash  P2PKH, base58check, version 0x4c → `X…`
 *   zec   transparent P2PKH, base58check, version 0x1cb8 → `t1…`
 *   bch   P2PKH as cashaddr → `bitcoincash:q…`
 *
 * Every one of them carries the same 20-byte key hash; only the wrapping differs.
 */
import { bech32, createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { concatBytes } from '@noble/hashes/utils.js';

const base58check = createBase58check(sha256);

/** P2PKH version bytes. */
export const DOGE_P2PKH_VERSION = [0x1e] as const;
export const DASH_P2PKH_VERSION = [0x4c] as const;
export const ZEC_P2PKH_VERSION = [0x1c, 0xb8] as const;

/** RIPEMD-160 of SHA-256: the key hash. */
export const hash160 = (publicKey: Uint8Array): Uint8Array => ripemd160(sha256(publicKey));

/** A version-0 witness program of the key hash (P2WPKH) under `hrp`. */
export function segwitAddress(hrp: string, publicKey: Uint8Array): string {
  return bech32.encode(hrp, [0, ...bech32.toWords(hash160(publicKey))]);
}

/** A base58check P2PKH address under the network's version bytes. */
export function p2pkhAddress(version: readonly number[], publicKey: Uint8Array): string {
  return base58check.encode(concatBytes(Uint8Array.from(version), hash160(publicKey)));
}

// cashaddr is bech32's alphabet with its own 40-bit checksum (the Bitcoin Cash spec).
const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CASHADDR_GENERATORS = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];

function cashaddrPolymod(values: readonly number[]): bigint {
  let c = 1n;
  for (const d of values) {
    const top = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    CASHADDR_GENERATORS.forEach((g, i) => {
      if ((top >> BigInt(i)) & 1n) c ^= g;
    });
  }
  return c ^ 1n;
}

/** Bitcoin Cash P2PKH as cashaddr, prefix included, as Trust Wallet shows it. */
export function cashAddress(publicKey: Uint8Array, prefix = 'bitcoincash'): string {
  // Version byte 0: P2PKH with a 160-bit hash.
  const payload = bech32.toWords(concatBytes(new Uint8Array([0]), hash160(publicKey)));
  const prefixWords = Array.from(prefix, (ch) => ch.charCodeAt(0) & 31);
  const mod = cashaddrPolymod([...prefixWords, 0, ...payload, 0, 0, 0, 0, 0, 0, 0, 0]);
  const checksum = Array.from({ length: 8 }, (_, i) => Number((mod >> BigInt(5 * (7 - i))) & 31n));
  return `${prefix}:${[...payload, ...checksum].map((w) => CASHADDR_CHARSET[w]).join('')}`;
}
