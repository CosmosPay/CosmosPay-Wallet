/**
 * The Solana and Monad addresses a recovery phrase also controls.
 *
 * One BIP-39 phrase is a seed for every chain; what differs is the derivation path. The
 * paths here are the ones the reference wallets use, so the same phrase shows the same
 * addresses in Phantom (Solana) and MetaMask (Monad, an EVM chain):
 *
 *   Solana  m/44'/501'/0'/0'   SLIP-0010 ed25519, base58 public key
 *   Monad   m/44'/60'/0'/0/0   BIP-32 secp256k1, keccak-256 → EIP-55 address
 *
 * That is what "restoring a wallet restores its Solana and Monad accounts" rests on: the
 * phrase comes back from the backup, and these addresses are a pure function of it. A
 * wallet imported from a bare Stellar secret (S…) has no phrase and therefore none of
 * these — a Stellar key is not a seed for another chain's path.
 *
 * Public addresses only. Nothing here stores or returns a private key.
 */
import { mnemonicToSeed } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@stellar/stellar-sdk';
import { HDKey } from '@scure/bip32';
import { base58 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { normalizeMnemonic } from '@/lib/wallet';

export interface ChainAddresses {
  /** Base58, as Phantom shows it. */
  solana: string;
  /** EIP-55 checksummed 0x address, as MetaMask shows it. */
  monad: string;
}

export const SOLANA_PATH = "m/44'/501'/0'/0'";
export const EVM_PATH = "m/44'/60'/0'/0/0";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** EIP-55: a hex address whose letter case is its own checksum. */
export function toChecksumAddress(lowerHex: string): string {
  const addr = lowerHex.toLowerCase().replace(/^0x/, '');
  const hash = hex(keccak_256(new TextEncoder().encode(addr)));
  let out = '0x';
  for (let i = 0; i < addr.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return out;
}

/** The Solana and Monad addresses of a recovery phrase. */
export async function chainAddressesFromMnemonic(phrase: string): Promise<ChainAddresses> {
  const seed = await mnemonicToSeed(normalizeMnemonic(phrase));

  const { key } = derivePath(SOLANA_PATH, seed.toString('hex'));
  const solana = base58.encode(Keypair.fromRawEd25519Seed(Buffer.from(key)).rawPublicKey());

  const node = HDKey.fromMasterSeed(new Uint8Array(seed)).derive(EVM_PATH);
  if (!node.publicKey) throw new Error('EVM derivation produced no public key');
  // keccak-256 of the uncompressed point without its 0x04 prefix; the address is the last 20 bytes.
  const uncompressed = secp256k1.Point.fromBytes(node.publicKey).toBytes(false);
  const monad = toChecksumAddress(hex(keccak_256(uncompressed.subarray(1)).subarray(12)));

  return { solana, monad };
}
