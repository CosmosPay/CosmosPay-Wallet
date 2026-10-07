/**
 * The Solana and Monad addresses a recovery phrase controls must be the ones the reference
 * wallets show for it — Phantom on `m/44'/501'/0'/0'`, MetaMask on `m/44'/60'/0'/0/0` — or a
 * person who moves the phrase to either finds a different, empty account.
 *
 * The vectors are the published ones for the BIP-39 test phrase.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base58 } from '@scure/base';
import { chainAddressesFromMnemonic, toChecksumAddress } from '@/lib/chainAddresses';
import { chainExportKeys } from '@/lib/chainKeys';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('the test phrase derives the reference wallets’ Solana and EVM addresses', async () => {
  const { solana, monad } = await chainAddressesFromMnemonic(PHRASE);
  assert.equal(monad, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
  assert.equal(solana, 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
});

test('a pasted phrase with stray spacing and case derives the same addresses', async () => {
  const messy = `  ${PHRASE.toUpperCase().replace(/ /g, '   ')}  `;
  assert.deepEqual(await chainAddressesFromMnemonic(messy), await chainAddressesFromMnemonic(PHRASE));
});

test('EIP-55 checksums match the specification’s examples', () => {
  for (const addr of [
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  ]) {
    assert.equal(toChecksumAddress(addr.toLowerCase()), addr);
  }
});

test('the exported keys are the ones Phantom and MetaMask import for the same addresses', async () => {
  const addresses = await chainAddressesFromMnemonic(PHRASE);
  const keys = await chainExportKeys(PHRASE, addresses);
  // MetaMask's first account for the BIP-39 test phrase.
  assert.equal(keys.monad, '0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727');
  // Phantom's format is seed ‖ public key; the second half IS the address.
  const pair = base58.decode(keys.solana);
  assert.equal(pair.length, 64);
  assert.equal(base58.encode(pair.subarray(32)), addresses.solana);
});

test('an export that disagrees with the address on screen is refused', async () => {
  await assert.rejects(chainExportKeys(PHRASE, { monad: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' }));
  await assert.rejects(chainExportKeys(PHRASE, { solana: 'So11111111111111111111111111111111111111112' }));
});
