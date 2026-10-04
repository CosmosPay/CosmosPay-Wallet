/**
 * The Solana and Monad SIGNING keys of a recovery phrase — the private half of
 * `lib/chainAddresses.ts`, and the only place the wallet derives one.
 *
 * Derived at the moment of signing and dropped with the closure that asked: nothing here
 * is stored, cached or returned beyond the call. The same paths as the public addresses,
 * and each key is checked against the address the wallet already shows before it signs
 * anything — a derivation that disagreed with the address on screen would sign for an
 * account the user never saw.
 */
import { mnemonicToSeed } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { HDKey } from '@scure/bip32';
import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519.js';
import { EVM_PATH, SOLANA_PATH } from '@/lib/chainAddresses';
import { evmAddressOf } from '@/lib/evmTx';
import { normalizeMnemonic } from '@/lib/wallet';
import type { OtherChain } from '@/constants/chains';

/** A 32-byte secret: an ed25519 seed on Solana, a secp256k1 scalar on Monad. */
export type ChainSecret = Uint8Array;

async function derive(phrase: string, chain: OtherChain): Promise<{ secret: ChainSecret; address: string }> {
  const seed = await mnemonicToSeed(normalizeMnemonic(phrase));
  if (chain === 'solana') {
    const { key } = derivePath(SOLANA_PATH, seed.toString('hex'));
    const secret = Uint8Array.from(key);
    return { secret, address: base58.encode(ed25519.getPublicKey(secret)) };
  }
  const node = HDKey.fromMasterSeed(new Uint8Array(seed)).derive(EVM_PATH);
  if (!node.privateKey) throw new Error('EVM derivation produced no private key');
  const secret = Uint8Array.from(node.privateKey);
  return { secret, address: evmAddressOf(secret) };
}

/**
 * The signing key of `chain` for `phrase`, provided it controls `expectedAddress`.
 * Throws otherwise — see the header for why that is not optional.
 */
export async function chainSecret(phrase: string, chain: OtherChain, expectedAddress: string): Promise<ChainSecret> {
  const { secret, address } = await derive(phrase, chain);
  const same = chain === 'monad' ? address.toLowerCase() === expectedAddress.toLowerCase() : address === expectedAddress;
  if (!same) throw new Error(`The ${chain} key of this phrase does not match the address the wallet shows`);
  return secret;
}
