/**
 * The signing keys of a phrase on every network (src/lib/chainKeys.ts `networkSecret`). What is
 * pinned: each family's key spells exactly the address the wallet shows for that phrase — the
 * same encoder (`addressOfKey`) on both sides — in the mode it is asked for (a test network's own
 * spelling where it has one), and a key is never handed out for an address it does not control.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { ED_KINDS, SECP_KINDS, addressOfKey, networkAddressesFromMnemonic } from '@/lib/chainAddresses';
import { networkSecret } from '@/lib/chainKeys';
import { testnetAddress } from '@/lib/testnets';
import { NETWORK_IDS, NETWORKS, type NetworkId } from '@/constants/networks';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** One network of each secp256k1 and ed25519 family. */
const networkOf = (kind: string): NetworkId => NETWORK_IDS.find((id) => NETWORKS[id].address === kind)!;

test('every secp256k1 and ed25519 family: the key spells the address the wallet shows', async () => {
  const shown = await networkAddressesFromMnemonic(PHRASE);
  for (const kind of SECP_KINDS) {
    const secret = await networkSecret(PHRASE, networkOf(kind), shown[kind]!, 'mainnet');
    assert.equal(secret.length, 32, kind);
    assert.equal(addressOfKey(kind, secp256k1.getPublicKey(secret, true)), shown[kind], kind);
  }
  for (const kind of ED_KINDS) {
    const secret = await networkSecret(PHRASE, networkOf(kind), shown[kind]!, 'mainnet');
    assert.equal(secret.length, 32, kind);
    assert.equal(addressOfKey(kind, ed25519.getPublicKey(secret)), shown[kind], kind);
  }
});

test('the EVM key serves every EVM network, in either case of the address', async () => {
  const { evm } = await networkAddressesFromMnemonic(PHRASE);
  const a = await networkSecret(PHRASE, 'base', evm!, 'mainnet');
  const b = await networkSecret(PHRASE, 'hood', evm!.toLowerCase(), 'mainnet');
  assert.deepEqual(a, b);
});

test('in test mode the key is checked against the test network spelling', async () => {
  const { btc } = await networkAddressesFromMnemonic(PHRASE);
  const tb1 = testnetAddress('btc', btc!)!;
  assert.ok(tb1.startsWith('tb1'));
  assert.equal((await networkSecret(PHRASE, 'btc', tb1, 'testnet')).length, 32);
  // the main spelling is not the test network's address
  await assert.rejects(networkSecret(PHRASE, 'btc', btc!, 'testnet'));
});

test('a key is never handed out for an address it does not control', async () => {
  const other = await networkAddressesFromMnemonic('illness spike retreat truth genius clock brain pass fit cave bargain toe');
  for (const kind of ['btc', 'xrp', 'tron', 'near', 'sui', 'aptos', 'ton'] as const) {
    await assert.rejects(networkSecret(PHRASE, networkOf(kind), other[kind]!, 'mainnet'), /does not match/, kind);
  }
});

test('Cardano: the 64-byte extended payment key, checked against the address in either mode', async () => {
  const { cardanoKeyControls } = await import('@/lib/send/cardano');
  const { cardano } = await networkAddressesFromMnemonic(PHRASE);
  const secret = await networkSecret(PHRASE, 'cardano', cardano!, 'mainnet');
  assert.equal(secret.length, 64);
  assert.ok(cardanoKeyControls(secret, cardano!, 'mainnet'));
  const preprod = testnetAddress('cardano', cardano!)!;
  assert.ok(preprod.startsWith('addr_test1'));
  assert.deepEqual(await networkSecret(PHRASE, 'cardano', preprod, 'testnet'), secret);
});

test('Starknet: the Stark key of the Argent account the wallet shows', async () => {
  const { starknet } = await networkAddressesFromMnemonic(PHRASE);
  const secret = await networkSecret(PHRASE, 'starknet', starknet!, 'mainnet');
  assert.equal(secret.length, 32);
  await assert.rejects(networkSecret(PHRASE, 'starknet', '0x0123', 'mainnet'), /does not match/);
});
