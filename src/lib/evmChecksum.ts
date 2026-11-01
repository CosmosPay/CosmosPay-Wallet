/**
 * EIP-55: a hex address whose letter case is its own checksum. On its own so the EVM signer
 * (`lib/evmTx.ts`) can spell an address without loading every network's derivation
 * (`lib/chainAddresses.ts`), which re-exports it.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';

export function toChecksumAddress(lowerHex: string): string {
  const addr = lowerHex.toLowerCase().replace(/^0x/, '');
  const hash = Array.from(keccak_256(new TextEncoder().encode(addr)), (b) => b.toString(16).padStart(2, '0')).join('');
  let out = '0x';
  for (let i = 0; i < addr.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return out;
}
