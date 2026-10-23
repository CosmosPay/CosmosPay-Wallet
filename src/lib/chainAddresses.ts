/**
 * The Bitcoin, EVM and Solana addresses a recovery phrase also controls.
 *
 * One BIP-39 phrase is a seed for every chain; what differs is the derivation path. The
 * paths here are the ones the reference wallets use, so the same phrase shows the same
 * addresses in Phantom (Solana), MetaMask (every EVM chain) and any BIP-84 Bitcoin wallet
 * (Sparrow, Electrum, BlueWallet):
 *
 *   Solana          m/44'/501'/0'/0'   SLIP-0010 ed25519, base58 public key
 *   EVM             m/44'/60'/0'/0/0   BIP-32 secp256k1, keccak-256 → EIP-55 address
 *   Bitcoin         m/84'/0'/0'/0/0    BIP-84 native SegWit, P2WPKH bech32 (bc1q…)
 *   Bitcoin testnet m/84'/1'/0'/0/0    the same on coin type 1 (tb1q…), as BIP-84 specifies
 *
 * ONE EVM address serves Ethereum, Arbitrum, Base and Monad: an EVM account is a key, not
 * a chain, and what keeps a signature on one chain from being replayed on another is the
 * chain id inside it (`lib/evmTx.ts`), never a different address.
 *
 * That is what "restoring a wallet restores its other chains" rests on: the phrase comes
 * back from the backup, and these addresses are a pure function of it. A wallet imported
 * from a bare Stellar secret (S…) has no phrase and therefore none of these — a Stellar
 * key is not a seed for another chain's path.
 *
 * Public addresses only. Nothing here stores or returns a private key.
 */
import { mnemonicToSeed } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@stellar/stellar-sdk';
import { HDKey } from '@scure/bip32';
import { base58 } from '@scure/base';
import { NETWORK, TEST_NETWORK, p2wpkh } from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { normalizeMnemonic } from '@/lib/wallet';
import type { ChainAddresses } from '@/lib/chainAddressBook';
import type { ChainNet } from '@/constants/chains';

export const SOLANA_PATH = "m/44'/501'/0'/0'";
export const EVM_PATH = "m/44'/60'/0'/0/0";
export const BITCOIN_PATH = "m/84'/0'/0'/0/0";
export const BITCOIN_TESTNET_PATH = "m/84'/1'/0'/0/0";

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

/** The P2WPKH address of a compressed secp256k1 public key on `net`. */
export function bitcoinAddressOf(compressedPub: Uint8Array, net: ChainNet): string {
  const address = p2wpkh(compressedPub, net === 'mainnet' ? NETWORK : TEST_NETWORK).address;
  if (!address) throw new Error('P2WPKH produced no address');
  return address;
}

/** The Solana, EVM and Bitcoin addresses of a recovery phrase. */
export async function chainAddressesFromMnemonic(phrase: string): Promise<ChainAddresses> {
  const seed = await mnemonicToSeed(normalizeMnemonic(phrase));

  const { key } = derivePath(SOLANA_PATH, seed.toString('hex'));
  const solana = base58.encode(Keypair.fromRawEd25519Seed(Buffer.from(key)).rawPublicKey());

  const root = HDKey.fromMasterSeed(new Uint8Array(seed));
  const evmNode = root.derive(EVM_PATH);
  if (!evmNode.publicKey) throw new Error('EVM derivation produced no public key');
  // keccak-256 of the uncompressed point without its 0x04 prefix; the address is the last 20 bytes.
  const uncompressed = secp256k1.Point.fromBytes(evmNode.publicKey).toBytes(false);
  const evm = toChecksumAddress(hex(keccak_256(uncompressed.subarray(1)).subarray(12)));

  const btcNode = root.derive(BITCOIN_PATH);
  const btcTestNode = root.derive(BITCOIN_TESTNET_PATH);
  if (!btcNode.publicKey || !btcTestNode.publicKey) throw new Error('Bitcoin derivation produced no public key');
  const bitcoin = bitcoinAddressOf(btcNode.publicKey, 'mainnet');
  const bitcoinTestnet = bitcoinAddressOf(btcTestNode.publicKey, 'testnet');

  return { solana, evm, bitcoin, bitcoinTestnet };
}
