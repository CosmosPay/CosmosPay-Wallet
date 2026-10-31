/**
 * The SIGNING keys of a recovery phrase on every network the wallet sends on — the private half
 * of `lib/chainAddresses.ts`, and the only place the wallet derives one: `chainSecret` for
 * Solana and Monad, `networkSecret` for any network by its address family. `chainExportKeys` is
 * the one function here that hands a key out, and only to the password-gated Export screen.
 *
 * Derived at the moment of signing and dropped with the closure that asked: nothing here
 * is stored, cached or returned beyond the call. The same paths as the public addresses,
 * and each key is checked against the address the wallet already shows before it signs
 * anything — a derivation that disagreed with the address on screen would sign for an
 * account the user never saw.
 */
import { mnemonicToEntropy, mnemonicToSeed } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { HDKey } from '@scure/bip32';
import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { ED_KINDS, EVM_PATH, SECP_KINDS, SOLANA_PATH, addressOfKey, type EdKind, type SecpKind } from '@/lib/chainAddresses';
import { evmAddressOf } from '@/lib/evmTx';
import { testnetAddress } from '@/lib/testnets';
import { normalizeMnemonic } from '@/lib/wallet';
import type { ChainNet, OtherChain } from '@/constants/chains';
import { DERIVATION_PATHS, NETWORKS, type NetworkId } from '@/constants/networks';

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

/** The phrase's other-chain keys in the form each reference wallet imports. */
export interface ChainExportKeys {
  /** Base58 of the 64-byte keypair (seed ‖ public key) — Phantom's "Import private key". */
  solana: string;
  /** 0x-prefixed 32-byte hex scalar — MetaMask's "Import account". */
  monad: string;
}

/**
 * The Solana and Monad private keys of `phrase`, for the Export screen only. Each is checked
 * against `expected` when the wallet already shows an address there, for the same reason
 * `chainSecret` is: a key that disagrees with the screen would export an account the user
 * never saw. The intermediate bytes are zeroed; the strings are the caller's to drop.
 */
export async function chainExportKeys(phrase: string, expected?: Partial<Record<OtherChain, string>>): Promise<ChainExportKeys> {
  const sol = await derive(phrase, 'solana');
  const evm = await derive(phrase, 'monad');
  try {
    if (expected?.solana && expected.solana !== sol.address) throw new Error('The solana key of this phrase does not match the address the wallet shows');
    if (expected?.monad && expected.monad.toLowerCase() !== evm.address.toLowerCase()) {
      throw new Error('The monad key of this phrase does not match the address the wallet shows');
    }
    const pair = new Uint8Array(64);
    pair.set(sol.secret, 0);
    pair.set(ed25519.getPublicKey(sol.secret), 32);
    const solana = base58.encode(pair);
    pair.fill(0);
    const monad = `0x${Array.from(evm.secret, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    return { solana, monad };
  } finally {
    sol.secret.fill(0);
    evm.secret.fill(0);
  }
}

const isSecp = (kind: string): kind is SecpKind => (SECP_KINDS as readonly string[]).includes(kind);
const isEd = (kind: string): kind is EdKind => (ED_KINDS as readonly string[]).includes(kind);

/** The family's signing key of `phrase` and the main-network address it controls. */
async function deriveNetwork(phrase: string, network: NetworkId): Promise<{ secret: Uint8Array; address: string }> {
  const kind = NETWORKS[network].address;
  const mnemonic = normalizeMnemonic(phrase);
  if (kind === 'cardano') {
    const { cardanoBaseAddress } = await import('@/lib/addresses/cardano');
    const { cardanoPaymentSecret } = await import('@/lib/send/cardano');
    const entropy = hexToBytes(mnemonicToEntropy(mnemonic));
    try {
      return { secret: cardanoPaymentSecret(entropy), address: cardanoBaseAddress(entropy) };
    } finally {
      entropy.fill(0);
    }
  }
  const seed = await mnemonicToSeed(mnemonic);
  try {
    if (kind === 'starknet') {
      // Argent X derives its Stark key from the EVM key, and the account address from that.
      const { argentAccountAddress } = await import('@/lib/addresses/starknet');
      const { starknetSecret } = await import('@/lib/send/starknet');
      const node = HDKey.fromMasterSeed(new Uint8Array(seed)).derive(EVM_PATH);
      try {
        if (!node.privateKey) throw new Error('EVM derivation produced no private key');
        return { secret: starknetSecret(node.privateKey), address: argentAccountAddress(node.privateKey) };
      } finally {
        node.wipePrivateData();
      }
    }
    if (isSecp(kind)) {
      const node = HDKey.fromMasterSeed(new Uint8Array(seed)).derive(DERIVATION_PATHS[kind]);
      try {
        if (!node.privateKey || !node.publicKey) throw new Error(`No key at ${DERIVATION_PATHS[kind]}`);
        return { secret: Uint8Array.from(node.privateKey), address: addressOfKey(kind, node.publicKey) };
      } finally {
        node.wipePrivateData();
      }
    }
    if (isEd(kind)) {
      const { key, chainCode } = derivePath(DERIVATION_PATHS[kind], seed.toString('hex'));
      const secret = Uint8Array.from(key);
      key.fill(0);
      chainCode.fill(0);
      return { secret, address: addressOfKey(kind, ed25519.getPublicKey(secret)) };
    }
    throw new Error(`The wallet derives no signing key for ${network}`);
  } finally {
    seed.fill(0);
  }
}

/**
 * The signing key of `network` for `phrase`, in the shape that network's sender takes
 * (`lib/send/types.ts`), provided it controls `expectedAddress` — the address the wallet shows
 * there in `env` (a test network's own spelling where it has one). Throws otherwise, for the
 * reason in the header.
 */
export async function networkSecret(phrase: string, network: NetworkId, expectedAddress: string, env: ChainNet): Promise<Uint8Array> {
  const { secret, address } = await deriveNetwork(phrase, network);
  const shown = env === 'mainnet' ? address : testnetAddress(network, address);
  const hexLike = (a: string) => (/^0x[0-9a-fA-F]+$/.test(a) ? a.toLowerCase() : a);
  if (!shown || hexLike(shown) !== hexLike(expectedAddress)) {
    secret.fill(0);
    throw new Error(`The ${network} key of this phrase does not match the address the wallet shows`);
  }
  return secret;
}
