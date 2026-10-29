/**
 * The address a recovery phrase controls on every network family the wallet holds
 * (`AddressKind` in `constants/networks.ts`).
 *
 * One BIP-39 phrase is a seed for every chain; what differs is the derivation path and how a
 * public key is spelled. Each family follows Trust Wallet Core's default, so the same phrase
 * imported into Trust Wallet shows the same addresses — except Solana, which follows Phantom
 * (`m/44'/501'/0'/0'`; Trust Wallet's default is `m/44'/501'/0'`), because that is the address
 * this wallet has shown since it first held one, and Starknet, which Trust Wallet lacks:
 *
 *   evm       m/44'/60'/0'/0/0       secp256k1, keccak-256 → EIP-55 (MetaMask's too)
 *   svm       m/44'/501'/0'/0'       SLIP-10 ed25519, base58 public key (Phantom)
 *   btc       m/84'/0'/0'/0/0        P2WPKH `bc1q…`
 *   ltc       m/84'/2'/0'/0/0        P2WPKH `ltc1q…`
 *   doge      m/44'/3'/0'/0/0        P2PKH `D…`
 *   bch       m/44'/145'/0'/0/0      P2PKH cashaddr `bitcoincash:q…`
 *   dash      m/44'/5'/0'/0/0        P2PKH `X…`
 *   zec       m/44'/133'/0'/0/0      transparent P2PKH `t1…`
 *   xrp       m/44'/144'/0'/0/0      classic address `r…`
 *   tron      m/44'/195'/0'/0/0      keccak-256 → base58check `T…`
 *   ton       m/44'/607'/0'          SLIP-10 ed25519, wallet v4R2 `UQ…` (`lib/addresses/ton.ts`)
 *   near      m/44'/397'/0'          SLIP-10 ed25519, implicit account = hex public key
 *   sui       m/44'/784'/0'/0'/0'    SLIP-10 ed25519, blake2b-256(0x00 ‖ key)
 *   aptos     m/44'/637'/0'/0'/0'    SLIP-10 ed25519, sha3-256(key ‖ 0x00)
 *   cardano   CIP-1852, Icarus       base address `addr1…` (`lib/addresses/cardano.ts`)
 *   starknet  Argent X               from the EVM key, Argent account v0.4.0 (`lib/addresses/starknet.ts`)
 *
 * Aleo is absent: no wallet shares a phrase-to-key standard for it, and its curve needs snarkVM,
 * megabytes of wasm.
 *
 * That is what "restoring a wallet restores its other networks" rests on: the phrase comes back
 * from the backup, and these addresses are a pure function of it. A wallet imported from a bare
 * Stellar secret (S…) has no phrase, so it gets one derived from that secret
 * (`networksPhraseFromSecret`) — deterministic, so the secret alone always brings it back.
 *
 * Public addresses only. Nothing here stores or returns a private key.
 */
import { entropyToMnemonic, mnemonicToEntropy, mnemonicToSeed } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@stellar/stellar-sdk';
import { HDKey } from '@scure/bip32';
import { base58, base58xrp, createBase58check } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { keccak_256, sha3_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { normalizeMnemonic } from '@/lib/wallet';
import {
  DASH_P2PKH_VERSION,
  DOGE_P2PKH_VERSION,
  ZEC_P2PKH_VERSION,
  cashAddress,
  hash160,
  p2pkhAddress,
  segwitAddress,
} from '@/lib/addresses/utxo';
import { tonWalletAddress } from '@/lib/addresses/ton';
import { cardanoBaseAddress } from '@/lib/addresses/cardano';
import { ADDRESS_KINDS, DERIVATION_PATHS, type AddressKind, type NetworkAddresses } from '@/constants/networks';
import { toChecksumAddress } from '@/lib/evmChecksum';

export { toChecksumAddress };

export interface ChainAddresses {
  /** Base58, as Phantom shows it. */
  solana: string;
  /** EIP-55 checksummed 0x address, as MetaMask shows it. */
  monad: string;
}

export const SOLANA_PATH = DERIVATION_PATHS.svm;
export const EVM_PATH = DERIVATION_PATHS.evm;

/** Each family's path (`constants/networks.ts`; Cardano's two are in `lib/addresses/cardano.ts`). */
export const NETWORK_PATHS = DERIVATION_PATHS;

/**
 * HKDF `info` of the phrase a secret-only wallet gets. Never change it: a new label is a new
 * phrase, and every such wallet's other networks would move to empty addresses.
 */
const NETWORKS_PHRASE_INFO = 'cosmos-wallet/networks-phrase/v1';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const base58check = createBase58check(sha256);


/** keccak-256 of the uncompressed point without its 0x04 prefix; the account is the last 20 bytes. */
const keccakAccount = (publicKey: Uint8Array) =>
  keccak_256(secp256k1.Point.fromBytes(publicKey).toBytes(false).subarray(1)).subarray(12);

const evmAddress = (publicKey: Uint8Array) => toChecksumAddress(hex(keccakAccount(publicKey)));

/** Tron: the EVM account under the 0x41 prefix, base58check. */
const tronAddress = (publicKey: Uint8Array) =>
  base58check.encode(concatBytes(new Uint8Array([0x41]), keccakAccount(publicKey)));

/** XRP Ledger: base58check of 0x00 ‖ key hash, in Ripple's alphabet. */
function xrpAddress(publicKey: Uint8Array): string {
  const payload = concatBytes(new Uint8Array([0x00]), hash160(publicKey));
  return base58xrp.encode(concatBytes(payload, sha256(sha256(payload)).subarray(0, 4)));
}

const suiAddress = (publicKey: Uint8Array) =>
  `0x${hex(blake2b(concatBytes(new Uint8Array([0x00]), publicKey), { dkLen: 32 }))}`;

const aptosAddress = (publicKey: Uint8Array) => `0x${hex(sha3_256(concatBytes(publicKey, new Uint8Array([0x00]))))}`;

/** The compressed secp256k1 public key at `path`; the private half is wiped before returning. */
function secpPublicKey(root: HDKey, path: string): Uint8Array {
  const node = root.derive(path);
  try {
    if (!node.publicKey) throw new Error(`No public key at ${path}`);
    return node.publicKey;
  } finally {
    node.wipePrivateData();
  }
}

/** The SLIP-10 ed25519 public key at `path` (every step hardened). */
function edPublicKey(seedHex: string, path: string): Uint8Array {
  const { key, chainCode } = derivePath(path, seedHex);
  const secret = Uint8Array.from(key);
  try {
    return ed25519.getPublicKey(secret);
  } finally {
    secret.fill(0);
    key.fill(0);
    chainCode.fill(0);
  }
}

/** The Solana and Monad addresses of a recovery phrase. */
export async function chainAddressesFromMnemonic(phrase: string): Promise<ChainAddresses> {
  const seed = await mnemonicToSeed(normalizeMnemonic(phrase));

  const { key } = derivePath(SOLANA_PATH, seed.toString('hex'));
  const solana = base58.encode(Keypair.fromRawEd25519Seed(Buffer.from(key)).rawPublicKey());

  const node = HDKey.fromMasterSeed(new Uint8Array(seed)).derive(EVM_PATH);
  if (!node.publicKey) throw new Error('EVM derivation produced no public key');
  const monad = evmAddress(node.publicKey);

  return { solana, monad };
}

/** Every family's address of `phrase`. A family this build cannot derive is absent, never guessed. */
export async function networkAddressesFromMnemonic(phrase: string): Promise<NetworkAddresses> {
  const mnemonic = normalizeMnemonic(phrase);
  const seed = await mnemonicToSeed(mnemonic);
  const seedHex = seed.toString('hex');
  const seedBytes = new Uint8Array(seed);
  const root = HDKey.fromMasterSeed(seedBytes);
  const secp = (kind: keyof typeof NETWORK_PATHS) => secpPublicKey(root, NETWORK_PATHS[kind]);
  const ed = (kind: keyof typeof NETWORK_PATHS) => edPublicKey(seedHex, NETWORK_PATHS[kind]);

  const derive: Partial<Record<AddressKind, () => string | Promise<string>>> = {
    evm: () => evmAddress(secp('evm')),
    svm: () => base58.encode(ed('svm')),
    btc: () => segwitAddress('bc', secp('btc')),
    ltc: () => segwitAddress('ltc', secp('ltc')),
    doge: () => p2pkhAddress(DOGE_P2PKH_VERSION, secp('doge')),
    bch: () => cashAddress(secp('bch')),
    dash: () => p2pkhAddress(DASH_P2PKH_VERSION, secp('dash')),
    zec: () => p2pkhAddress(ZEC_P2PKH_VERSION, secp('zec')),
    xrp: () => xrpAddress(secp('xrp')),
    tron: () => tronAddress(secp('tron')),
    ton: () => tonWalletAddress(ed('ton')),
    near: () => hex(ed('near')),
    sui: () => suiAddress(ed('sui')),
    aptos: () => aptosAddress(ed('aptos')),
    cardano: () => {
      const entropy = hexToBytes(mnemonicToEntropy(mnemonic));
      try {
        return cardanoBaseAddress(entropy);
      } finally {
        entropy.fill(0);
      }
    },
    starknet: async () => {
      const { argentAccountAddress } = await import('@/lib/addresses/starknet');
      const node = root.derive(EVM_PATH);
      try {
        if (!node.privateKey) throw new Error('EVM derivation produced no private key');
        return argentAccountAddress(node.privateKey);
      } finally {
        node.wipePrivateData();
      }
    },
  };

  const addresses: NetworkAddresses = {};
  try {
    for (const kind of ADDRESS_KINDS) {
      try {
        const address = await derive[kind]?.();
        if (address) addresses[kind] = address;
      } catch {
        // A derivation bug costs its own network, not every other one.
      }
    }
  } finally {
    root.wipePrivateData();
    seed.fill(0);
    seedBytes.fill(0);
  }
  return addresses;
}

/**
 * A 12-word BIP-39 phrase derived from a Stellar secret (S…), for wallets imported without a
 * phrase: HKDF-SHA256 of the secret's 32-byte ed25519 seed (empty salt, `NETWORKS_PHRASE_INFO`)
 * gives 16 bytes of entropy. Deterministic, so the S… key alone — a backup, a transfer, an
 * export — always brings the same phrase, and so the same addresses, back.
 */
export function networksPhraseFromSecret(stellarSecret: string): string {
  // rawSecretKey() is the keypair's own buffer; the keypair goes out of scope with it zeroed.
  const seed = Keypair.fromSecret(stellarSecret).rawSecretKey();
  const entropy = hkdf(sha256, seed, new Uint8Array(0), utf8ToBytes(NETWORKS_PHRASE_INFO), 16);
  const buffer = Buffer.from(entropy);
  try {
    return entropyToMnemonic(buffer);
  } finally {
    seed.fill(0);
    entropy.fill(0);
    buffer.fill(0);
  }
}
