/**
 * The Bitcoin, EVM and Solana SIGNING keys of a recovery phrase — the private half of
 * `lib/chainAddresses.ts`, and the only place the wallet derives one. `chainExportKeys` is
 * the one function here that hands a key out, and only to the password-gated Export screen.
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
import { NETWORK, WIF } from '@scure/btc-signer';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { BITCOIN_PATH, BITCOIN_TESTNET_PATH, EVM_PATH, SOLANA_PATH, bitcoinAddressOf } from '@/lib/chainAddresses';
import { chainAddressOf, type StoredChainAddresses } from '@/lib/chainAddressBook';
import { evmAddressOf } from '@/lib/evmTx';
import { normalizeMnemonic } from '@/lib/wallet';
import type { ChainNet, OtherChain } from '@/constants/chains';

/** A 32-byte secret: an ed25519 seed on Solana, a secp256k1 scalar on Bitcoin and the EVM chains. */
export type ChainSecret = Uint8Array;

type Family = 'solana' | 'evm' | 'bitcoin' | 'bitcoinTestnet';

const familyOf = (chain: OtherChain, net: ChainNet): Family =>
  chain === 'solana' ? 'solana' : chain === 'bitcoin' ? (net === 'mainnet' ? 'bitcoin' : 'bitcoinTestnet') : 'evm';

async function derive(phrase: string, family: Family): Promise<{ secret: ChainSecret; address: string }> {
  const seed = await mnemonicToSeed(normalizeMnemonic(phrase));
  if (family === 'solana') {
    const { key } = derivePath(SOLANA_PATH, seed.toString('hex'));
    const secret = Uint8Array.from(key);
    return { secret, address: base58.encode(ed25519.getPublicKey(secret)) };
  }
  const path = family === 'evm' ? EVM_PATH : family === 'bitcoin' ? BITCOIN_PATH : BITCOIN_TESTNET_PATH;
  const node = HDKey.fromMasterSeed(new Uint8Array(seed)).derive(path);
  if (!node.privateKey) throw new Error(`${family} derivation produced no private key`);
  const secret = Uint8Array.from(node.privateKey);
  if (family === 'evm') return { secret, address: evmAddressOf(secret) };
  const pub = secp256k1.getPublicKey(secret, true);
  return { secret, address: bitcoinAddressOf(pub, family === 'bitcoin' ? 'mainnet' : 'testnet') };
}

/** Bech32 is case-insensitive and EIP-55 is a checksum over case; base58 is exact. */
const sameAddress = (chain: OtherChain, a: string, b: string): boolean =>
  chain === 'solana' ? a === b : a.toLowerCase() === b.toLowerCase();

/**
 * The signing key of `chain` on `net` for `phrase`, provided it controls `expectedAddress`.
 * Throws otherwise — see the header for why that is not optional. Only Bitcoin's key
 * depends on the network (BIP-84 coin type 1 on testnet).
 */
export async function chainSecret(
  phrase: string,
  chain: OtherChain,
  expectedAddress: string,
  net: ChainNet = 'mainnet',
): Promise<ChainSecret> {
  const { secret, address } = await derive(phrase, familyOf(chain, net));
  if (!sameAddress(chain, address, expectedAddress)) {
    secret.fill(0);
    throw new Error(`The ${chain} key of this phrase does not match the address the wallet shows`);
  }
  return secret;
}

/** The phrase's other-chain keys in the form each reference wallet imports. */
export interface ChainExportKeys {
  /** Base58 of the 64-byte keypair (seed ‖ public key) — Phantom's "Import private key". */
  solana: string;
  /** 0x-prefixed 32-byte hex scalar — MetaMask's "Import account", on every EVM chain. */
  evm: string;
  /** Compressed-key WIF of the BIP-84 key — Electrum / Sparrow import it as `p2wpkh:<WIF>`. */
  bitcoin: string;
}

/**
 * The Solana, EVM and Bitcoin private keys of `phrase`, for the Export screen only. Each is
 * checked against `expected` when the wallet already shows an address there, for the same
 * reason `chainSecret` is: a key that disagrees with the screen would export an account
 * the user never saw. The intermediate bytes are zeroed; the strings are the caller's to drop.
 */
export async function chainExportKeys(phrase: string, expected?: StoredChainAddresses): Promise<ChainExportKeys> {
  const sol = await derive(phrase, 'solana');
  const evm = await derive(phrase, 'evm');
  const btc = await derive(phrase, 'bitcoin');
  try {
    const mismatch = (chain: OtherChain, got: string) => {
      const shown = chainAddressOf(expected, chain, 'mainnet');
      if (shown && !sameAddress(chain, shown, got)) {
        throw new Error(`The ${chain} key of this phrase does not match the address the wallet shows`);
      }
    };
    mismatch('solana', sol.address);
    // One EVM address for every EVM chain, so any of them stands for all four.
    mismatch('ethereum', evm.address);
    mismatch('bitcoin', btc.address);
    const pair = new Uint8Array(64);
    pair.set(sol.secret, 0);
    pair.set(ed25519.getPublicKey(sol.secret), 32);
    const solana = base58.encode(pair);
    pair.fill(0);
    const evmHex = `0x${Array.from(evm.secret, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    const bitcoin = WIF(NETWORK).encode(btc.secret);
    return { solana, evm: evmHex, bitcoin };
  } finally {
    sol.secret.fill(0);
    evm.secret.fill(0);
    btc.secret.fill(0);
  }
}
