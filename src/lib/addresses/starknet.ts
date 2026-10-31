/**
 * The Starknet account a recovery phrase opens in Argent X (now Ready): its first standard
 * account. Trust Wallet has no Starknet, so Argent is the reference.
 *
 *   key      Argent seeds a BIP-32 tree with the phrase's Ethereum key (`m/44'/60'/0'/0/0`, read
 *            as a number, so leading zero bytes are dropped), takes `m/44'/9004'/0'/0/0` and
 *            grinds it onto the Stark curve (EIP-2645 `grindKey`); the public key is the point's x
 *   address  the contract address of Argent's account class v0.4.0 (its latest), salt = the
 *            public key, deployer 0, constructor (owner: Signer::Starknet(key), guardian: None)
 *
 * A Starknet account is a contract, so its address names a class as much as a key: the same key
 * under another wallet's class (Braavos) is another address. Checked against Argent's own code —
 * `getAccountContractAddress` and `TXV3_ACCOUNT_CLASS_HASH` from `@argent/x-shared`, and the key
 * vectors in its extension's `keyDerivation.test.ts`. If Argent ships a newer default class, this
 * address stays the account's (it is fixed by the class it is deployed with), but a fresh Argent
 * install would show the new class's address instead.
 *
 * Loaded on its own (`lib/chainAddresses.ts` imports it dynamically): the Pedersen hash
 * precomputes its tables when the module loads.
 */
import { HDKey } from '@scure/bip32';
import { getStarkKey, grindKey, pedersen } from '@scure/starknet';
import { bytesToNumberBE } from '@noble/curves/utils.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

export const ARGENT_PATH = "m/44'/9004'/0'/0/0";
/** Argent account v0.4.0. */
const ARGENT_ACCOUNT_CLASS_HASH = 0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927fn;
const CONTRACT_ADDRESS_PREFIX = bytesToNumberBE(utf8ToBytes('STARKNET_CONTRACT_ADDRESS'));
/** Addresses are below 2^251 − 256 (the storage-item bound). */
const ADDRESS_BOUND = 2n ** 251n - 256n;
// Cairo's serialisation of the constructor: an enum is its variant index then its fields, and
// Option::None is variant 1.
const SIGNER_STARKNET = 0n;
const GUARDIAN_NONE = 1n;

/** Starknet's hash of a list: Pedersen folded from 0 over the elements, then their count. */
const hashOnElements = (data: readonly bigint[]): bigint =>
  BigInt([...data, BigInt(data.length)].reduce<string | bigint>((acc, x) => pedersen(acc, x), 0n));

/** The Argent X account of the phrase whose Ethereum private key is `ethPrivateKey`. */
export function argentAccountAddress(ethPrivateKey: Uint8Array): string {
  const firstByte = ethPrivateKey.findIndex((b) => b !== 0);
  const master = HDKey.fromMasterSeed(ethPrivateKey.subarray(firstByte < 0 ? ethPrivateKey.length : firstByte));
  const node = master.derive(ARGENT_PATH);
  try {
    if (!node.privateKey) throw new Error(`No private key at ${ARGENT_PATH}`);
    const publicKey = BigInt(getStarkKey(grindKey(node.privateKey)));
    const calldataHash = hashOnElements([SIGNER_STARKNET, publicKey, GUARDIAN_NONE]);
    const hash = hashOnElements([CONTRACT_ADDRESS_PREFIX, 0n, publicKey, ARGENT_ACCOUNT_CLASS_HASH, calldataHash]);
    return `0x${(hash % ADDRESS_BOUND).toString(16).padStart(64, '0')}`;
  } finally {
    node.wipePrivateData();
    master.wipePrivateData();
  }
}
