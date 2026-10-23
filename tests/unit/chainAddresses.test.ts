/**
 * The Solana, EVM and Bitcoin addresses a recovery phrase controls must be the ones the
 * reference wallets show for it — Phantom on `m/44'/501'/0'/0'`, MetaMask on
 * `m/44'/60'/0'/0/0`, any BIP-84 wallet on `m/84'/0'/0'/0/0` — or a person who moves the
 * phrase to one of them finds a different, empty account.
 *
 * The vectors are the published ones for the BIP-39 test phrase (BIP-84's own test vectors
 * for Bitcoin).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base58 } from '@scure/base';
import { chainAddressesFromMnemonic, toChecksumAddress } from '@/lib/chainAddresses';
import { chainAddressOf as addressOn, isCompleteChainAddresses } from '@/lib/chainAddressBook';
import { chainExportKeys, chainSecret } from '@/lib/chainKeys';
import { OTHER_CHAINS } from '@/constants/chains';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('the test phrase derives the reference wallets’ Solana, EVM and Bitcoin addresses', async () => {
  const { solana, evm, bitcoin, bitcoinTestnet } = await chainAddressesFromMnemonic(PHRASE);
  assert.equal(evm, '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
  assert.equal(solana, 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk');
  // BIP-84's first receive address for this phrase.
  assert.equal(bitcoin, 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
  assert.equal(bitcoinTestnet, 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl');
});

test('a pasted phrase with stray spacing and case derives the same addresses', async () => {
  const messy = `  ${PHRASE.toUpperCase().replace(/ /g, '   ')}  `;
  assert.deepEqual(await chainAddressesFromMnemonic(messy), await chainAddressesFromMnemonic(PHRASE));
});

test('one EVM address serves every EVM chain; only Bitcoin changes on its test network', async () => {
  const addrs = await chainAddressesFromMnemonic(PHRASE);
  for (const chain of ['ethereum', 'arbitrum', 'base', 'monad'] as const) {
    assert.equal(addressOn(addrs, chain, 'mainnet'), addrs.evm);
    assert.equal(addressOn(addrs, chain, 'testnet'), addrs.evm);
  }
  assert.equal(addressOn(addrs, 'bitcoin', 'mainnet'), addrs.bitcoin);
  assert.equal(addressOn(addrs, 'bitcoin', 'testnet'), addrs.bitcoinTestnet);
  assert.equal(addressOn(addrs, 'solana', 'testnet'), addrs.solana);
});

test('an entry written before Bitcoin existed still answers for its chains, and is re-derived', () => {
  // The shape every wallet saved before this release: the EVM address under `monad`.
  const legacy = { solana: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk', monad: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94' };
  assert.equal(addressOn(legacy, 'arbitrum', 'mainnet'), legacy.monad);
  assert.equal(addressOn(legacy, 'bitcoin', 'mainnet'), null);
  assert.equal(isCompleteChainAddresses(legacy), false);
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

test('the exported keys are the ones Phantom, MetaMask and Electrum import for the same addresses', async () => {
  const addresses = await chainAddressesFromMnemonic(PHRASE);
  const keys = await chainExportKeys(PHRASE, addresses);
  // MetaMask's first account for the BIP-39 test phrase.
  assert.equal(keys.evm, '0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727');
  // BIP-84's published private key for bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu.
  assert.equal(keys.bitcoin, 'KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d');
  // Phantom's format is seed ‖ public key; the second half IS the address.
  const pair = base58.decode(keys.solana);
  assert.equal(pair.length, 64);
  assert.equal(base58.encode(pair.subarray(32)), addresses.solana);
});

test('an export that disagrees with the address on screen is refused', async () => {
  await assert.rejects(chainExportKeys(PHRASE, { evm: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' }));
  await assert.rejects(chainExportKeys(PHRASE, { monad: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' }));
  await assert.rejects(chainExportKeys(PHRASE, { solana: 'So11111111111111111111111111111111111111112' }));
  await assert.rejects(chainExportKeys(PHRASE, { bitcoin: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }));
});

test('every chain’s signing key is checked against the address it is about to sign for', async () => {
  const addrs = await chainAddressesFromMnemonic(PHRASE);
  for (const chain of OTHER_CHAINS) {
    for (const net of ['mainnet', 'testnet'] as const) {
      const shown = addressOn(addrs, chain, net)!;
      const secret = await chainSecret(PHRASE, chain, shown, net);
      assert.equal(secret.length, 32, `${chain}/${net}`);
    }
  }
  // Bitcoin's testnet key is NOT its mainnet key (BIP-84 coin type 1).
  await assert.rejects(chainSecret(PHRASE, 'bitcoin', addrs.bitcoin, 'testnet'));
  await assert.rejects(chainSecret(PHRASE, 'ethereum', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'));
});
