/**
 * The addresses a recovery phrase controls must be the ones the reference wallets show for it,
 * or a person who moves the phrase to one of them finds a different, empty account: Phantom on
 * `m/44'/501'/0'/0'`, MetaMask on `m/44'/60'/0'/0/0`, Trust Wallet Core's default for every
 * other family, and Argent X for Starknet.
 *
 * Every vector below was produced by the reference itself, never by this code: Trust Wallet
 * Core's wasm build (`@trustwallet/wallet-core` 4.8.7, `HDWallet.getAddressForCoin`; Solana with
 * its `solanaSolana` derivation, Phantom's path), cross-checked with `@ton/ton`
 * (`WalletContractV4`), `@mysten/sui`, `@aptos-labs/ts-sdk` and `ethers`; Starknet with Argent's
 * own code (`@argent/x-shared` 1.79.4 `getAccountContractAddress`, its key derivation run
 * verbatim). Forty random phrases of every length (12 to 24 words) and three whose Ethereum key
 * starts with a zero byte matched as well; they are not pinned here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hkdfSync } from 'node:crypto';
import { base58 } from '@scure/base';
import { entropyToMnemonic, validateMnemonic } from 'bip39';
import { Keypair } from '@stellar/stellar-sdk';
import {
  chainAddressesFromMnemonic,
  networkAddressesFromMnemonic,
  networksPhraseFromSecret,
  toChecksumAddress,
} from '@/lib/chainAddresses';
import { chainExportKeys } from '@/lib/chainKeys';
import { NETWORKS, type NetworkId } from '@/constants/networks';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE_2 = 'illness spike retreat truth genius clock brain pass fit cave bargain toe';

const VECTORS = {
  [PHRASE]: {
    evm: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    svm: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk',
    btc: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    ltc: 'ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh',
    doge: 'DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC',
    bch: 'bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6',
    dash: 'XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5',
    zec: 't1XVXWCvpMgBvUaed4XDqWtgQgJSu1Ghz7F',
    xrp: 'rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3',
    tron: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH',
    ton: 'UQAzWZa6nM5mJev91wGc7VCSfBoIsYRqKJpV78N8Add9-RKY',
    near: '5510e2b44cae6eb807e3e0e45d579dda058c274abcba15e5cb84636f5d1ee412',
    sui: '0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1',
    aptos: '0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf',
    starknet: '0x0424e0202bce2d9abbee87ee8faa8fd416bcf02ad8fe18d66320f23b1b07fc02',
    cardano:
      'addr1qy8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mq4afdhv',
  },
  [PHRASE_2]: {
    evm: '0x6b30c7d7657A83141186Cd8c155CDB90C8750371',
    svm: 'EfMyugvKBr7JPsxFTUE7Z67sBNJj9NWCRbyt9p7fojBN',
    btc: 'bc1qqcf2nlc5m99tdlj2p5ca8mmpkf2sf220laemtd',
    ltc: 'ltc1qzuvtd4a5g4t92fgqgfn6fajk7lz5kh7awrsnhn',
    doge: 'DAtx21AEGa2Gif4fDopukQBDW98oAM1ix5',
    bch: 'bitcoincash:qq9h84yea9v3t6hgng5dymqmd0x94pjwqcjc8htvv4',
    dash: 'XdsFCTbauJQB4EknyQHgo5uwH6VF8C3HjP',
    zec: 't1aTCFniVVhK2SwwbpeV1T1F9VPLQAQih3v',
    xrp: 'rHfsP8wmWDEvSvBZu4VsF9BUB6wqXDo4xU',
    tron: 'TZEyykBZFxNWuzGRNYchfpmjWsQpcVzgkQ',
    ton: 'UQCogCt3umDv0NtKrNFjut50sda8ogtxpwxh-rwp80SPtjdr',
    near: '80683efcad5c1bc2be7f4dd24f7799c8ae84a4246b44f38a1cb857f5f22b6efd',
    sui: '0x5057d1e875f77e2a38e1a5d10d2bd16deeec6a917ddc7f68e21d3414889df33d',
    aptos: '0x5576e38a1a31a56b9bf748ace6fab0d395fa1acb49f0a811cfe42fd240fae3dc',
    starknet: '0x03dd58b5ed0d6b73b453599955e61266e7fb6da266f796de8138ff41edd53e7d',
    cardano:
      'addr1q8z5mpx09p9xjsphdmlu2fyx29g7d6rdqpzpjemjnfu0k8sqgdndvkuw66qd2z8ap3geapu2wysjlfgzpxzye2vf6gmsmu39qn',
  },
} as const;

/**
 * What the community server accepts for a network's account — the rules of its
 * `cross-chain-networks.ts`, with the patterns of `cross-chain-swaps.constants.ts` and
 * `chain-address.ts` copied as they are: the wallet hands these addresses to its cross-chain swaps.
 */
const BASE58 = '[1-9A-HJ-NP-Za-km-z]';
const BECH32 = '[02-9ac-hj-np-z]';
/** Bech32 is matched in lowercase there, and only when the input is in one case. */
const singleCase = (a: string) => (a === a.toLowerCase() || a === a.toUpperCase() ? a.toLowerCase() : '');
const utxo = (bech: RegExp | null, b58: RegExp) => (a: string) => b58.test(a) || (bech?.test(singleCase(a)) ?? false);
const exact = (...res: RegExp[]) => (a: string) => res.some((re) => re.test(a));
const SERVER_RULES: Record<string, (address: string) => boolean> = {
  evm: exact(/^0x[a-fA-F0-9]{40}$/),
  svm: (a) => a.length >= 32 && a.length <= 44 && base58.decode(a).length === 32,
  btc: utxo(new RegExp(`^bc1${BECH32}{39,59}$`), new RegExp(`^[13]${BASE58}{25,34}$`)),
  ltc: utxo(new RegExp(`^ltc1${BECH32}{39,59}$`), new RegExp(`^[LM3]${BASE58}{26,33}$`)),
  doge: utxo(null, new RegExp(`^[DA9]${BASE58}{25,33}$`)),
  bch: utxo(
    new RegExp(`^(?:bitcoincash:)?[qp](?:${BECH32}{41}|${BECH32}{60})$`),
    new RegExp(`^[13]${BASE58}{25,34}$`),
  ),
  dash: utxo(null, new RegExp(`^[X7]${BASE58}{33}$`)),
  zec: utxo(new RegExp(`^u1${BECH32}{100,1000}$`), new RegExp(`^t[13]${BASE58}{33}$`)),
  xrp: exact(new RegExp(`^r${BASE58}{24,34}$`)),
  tron: exact(new RegExp(`^T${BASE58}{33}$`)),
  ton: exact(/^[A-Za-z0-9_-]{48}$|^[A-Za-z0-9+/]{48}$/, /^(?:0|-1):[0-9a-fA-F]{64}$/),
  near: exact(/^(?=.{2,64}$)(?:(?:[a-z\d]+[-_])*[a-z\d]+\.)*(?:[a-z\d]+[-_])*[a-z\d]+$/),
  sui: exact(/^0x[0-9a-fA-F]{64}$/),
  aptos: exact(/^0x[0-9a-fA-F]{1,64}$/),
  starknet: exact(/^0x[0-9a-fA-F]{1,64}$/),
  cardano: exact(new RegExp(`^addr1${BECH32}{50,200}$`)),
};

test('every family of both phrases is the reference wallets’ address, and Aleo is absent', async () => {
  for (const [phrase, expected] of Object.entries(VECTORS)) {
    assert.deepEqual(await networkAddressesFromMnemonic(phrase), expected, phrase);
  }
});

test('every derived address passes the server’s rule for each network that uses it', async () => {
  for (const phrase of Object.keys(VECTORS)) {
    const addresses = await networkAddressesFromMnemonic(phrase);
    for (const id of Object.keys(NETWORKS) as NetworkId[]) {
      const kind = NETWORKS[id].address;
      if (kind === 'stellar') continue;
      const address = addresses[kind];
      if (address === undefined) continue;
      const accepts = SERVER_RULES[kind];
      assert.ok(accepts, `no server rule pinned for ${kind}`);
      assert.ok(accepts(address), `${id}: ${address}`);
    }
  }
});

test('the network addresses agree with the Solana and Monad ones the wallet already shows', async () => {
  for (const phrase of Object.keys(VECTORS)) {
    const { solana, monad } = await chainAddressesFromMnemonic(phrase);
    const all = await networkAddressesFromMnemonic(phrase);
    assert.equal(all.svm, solana);
    assert.equal(all.evm, monad);
  }
});

test('a family that cannot be derived is left out and the others go on', async () => {
  // Twelve "abandon": a bad checksum. Only Cardano reads the phrase's entropy, which refuses it.
  const addresses = await networkAddressesFromMnemonic(Array(12).fill('abandon').join(' '));
  assert.equal(addresses.cardano, undefined);
  assert.equal(addresses.aleo, undefined);
  assert.equal(Object.keys(addresses).length, 15);
});

test('a pasted phrase with stray spacing and case derives the same network addresses', async () => {
  const messy = `  ${PHRASE_2.toUpperCase().replace(/ /g, '   ')}  `;
  assert.deepEqual(await networkAddressesFromMnemonic(messy), VECTORS[PHRASE_2]);
});

const SECRET_A = 'SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X'; // raw seed 0x07 × 32
const SECRET_B = 'SAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQMUP'; // raw seed 0x08 × 32

test('a secret-only wallet’s phrase is pinned, valid BIP-39 and the same every time', () => {
  const phrase = networksPhraseFromSecret(SECRET_A);
  assert.equal(phrase, 'ugly victory used utility enjoy field bag crop slim hole brief quality');
  assert.equal(phrase.split(' ').length, 12);
  assert.ok(validateMnemonic(phrase));
  assert.equal(networksPhraseFromSecret(SECRET_A), phrase);
});

test('the phrase is HKDF-SHA256 of the secret’s seed, as specified', () => {
  const seed = Keypair.fromSecret(SECRET_A).rawSecretKey();
  const entropy = Buffer.from(hkdfSync('sha256', seed, Buffer.alloc(0), 'cosmos-wallet/networks-phrase/v1', 16));
  assert.equal(networksPhraseFromSecret(SECRET_A), entropyToMnemonic(entropy));
});

test('another secret gives another phrase, and a phrase that derives every network', async () => {
  const other = networksPhraseFromSecret(SECRET_B);
  assert.equal(other, 'charge moon peace color nature drama benefit suit room song damp guard');
  assert.notEqual(other, networksPhraseFromSecret(SECRET_A));
  assert.deepEqual(Object.keys(await networkAddressesFromMnemonic(other)).sort(), Object.keys(VECTORS[PHRASE]).sort());
});

test('a malformed secret is refused rather than turned into a phrase', () => {
  assert.throws(() => networksPhraseFromSecret('SNOTASECRET'));
});

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
