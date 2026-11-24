/**
 * The asset registry.
 *
 * What this guards is an identity decision, not a formatting one: the registry is
 * what stands between a user and one of the twenty accounts issuing a token called
 * `USDC` on mainnet. The failure it is written against is a lookup by CODE — which
 * would answer "Circle" for any of them, on a screen whose whole purpose is to help
 * someone decide whether to trust one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bundledAssets,
  findRegistryAsset,
  isVerifiedAsset,
  issuerLabel,
  withoutProviderNames,
} from '@/lib/assetRegistry';
import { namesProvider } from '@/lib/providerNames';
import { BUNDLED_ASSETS } from '@/constants/assetRegistry';

const CIRCLE_USDC = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const TETHER_USDT0 = 'GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q';
const CIRCLE_EURC = 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2';
const MYKOBO_EURC = 'GAQRF3UGHBT6JYQZ7YSUYCIYWAF4T2SAA5237Q5LIQYJOHHFAWDXZ7NM';
/* One of the eight accounts squatting the USDT0 code on mainnet. */
const FAKE_USDT0 = 'GBL35PWBKAHURS7SMATHXTS5X57BHC23P2B6MOJTDXTDKD7K25QHUSDT';

const publicList = bundledAssets('public');

test('an entry is found by the (code, issuer) pair', () => {
  const found = findRegistryAsset(publicList, { code: 'USDT0', issuer: TETHER_USDT0 });
  assert.equal(found?.issuerName, 'Tether');
});

test('a look-alike issuer under a known code is NOT found', () => {
  // The whole point. `FAKE_USDT0` really does issue a token spelled USDT0; if the
  // lookup keyed on the code it would come back as Tether's, verified.
  assert.equal(findRegistryAsset(publicList, { code: 'USDT0', issuer: FAKE_USDT0 }), null);
  assert.equal(isVerifiedAsset(publicList, { code: 'USDT0', issuer: FAKE_USDT0 }), false);
  assert.equal(issuerLabel(publicList, { code: 'USDT0', issuer: FAKE_USDT0 }), '');
});

test('two legitimate issuers of one code stay distinct', () => {
  // Both EURCs are real. A registry that collapsed them would make the picker
  // unable to express which one the user meant.
  assert.equal(issuerLabel(publicList, { code: 'EURC', issuer: CIRCLE_EURC }), 'Circle');
  assert.equal(issuerLabel(publicList, { code: 'EURC', issuer: MYKOBO_EURC }), 'MyKobo');
});

test('an unknown pair is unverified rather than absent-and-trusted', () => {
  // `isVerifiedAsset` is read to decide how a row is PAINTED, so its answer for
  // something we know nothing about has to be false, not undefined.
  assert.equal(isVerifiedAsset(publicList, { code: 'WHATEVER', issuer: CIRCLE_USDC }), false);
  assert.equal(isVerifiedAsset(publicList, null), false);
  assert.equal(isVerifiedAsset(publicList, undefined), false);
});

test('the native asset is the entry with a null issuer', () => {
  assert.equal(findRegistryAsset(publicList, { code: 'XLM', issuer: null })?.verified, true);
});

test('a custom network vouches for nothing', () => {
  // No bundled entries means every asset there takes the unverified path, which
  // is the honest answer: we have not checked anyone's private Horizon.
  assert.deepEqual(bundledAssets('some-custom-net'), []);
});

test('USDT0 is present, and it is Tether', () => {
  const usdt0 = publicList.filter((a) => a.code === 'USDT0');
  assert.equal(usdt0.length, 1);
  assert.equal(usdt0[0].issuer, TETHER_USDT0);
  assert.equal(usdt0[0].verified, true);
});

/**
 * Rows whose issuer is a service Cosmos Pay is built on: the copy never names it
 * (constants/providerNames.ts), so the row carries no issuer name on purpose and screens show
 * its issuer's address instead. A new entry here needs that reason, nothing less.
 */
const UNNAMED_ON_PURPOSE = ['testnet USDB'];

test('every entry names its issuer, unless the issuer is a provider', () => {
  // `issuerName` is the only thing distinguishing two rows that share a code, and
  // on testnet it is the only identifying information at all — no testnet issuer
  // publishes a home domain.
  const unnamed: string[] = [];
  for (const [network, list] of Object.entries(BUNDLED_ASSETS)) {
    for (const asset of list) {
      if (!asset.issuerName.trim()) unnamed.push(`${network} ${asset.code}`);
    }
  }
  assert.deepEqual(unnamed, UNNAMED_ON_PURPOSE);
});

test('no bundled row names a provider, and a fetched one that does is shown without it', () => {
  for (const asset of Object.values(BUNDLED_ASSETS).flat()) {
    assert.ok(!namesProvider(asset.issuerName) && !namesProvider(asset.name), `${asset.code} names a provider`);
  }
  // What the server's registry answered for USDB before this was fixed.
  const fromServer = { ...bundledAssets('testnet').find((a) => a.code === 'USDB')!, name: 'USD BlindPay', issuerName: 'BlindPay' };
  const shown = withoutProviderNames(fromServer);
  assert.equal(shown.issuerName, '');
  assert.equal(shown.name, 'USDB');
  assert.equal(shown.issuer, fromServer.issuer, 'the identity is untouched');
  assert.equal(shown.verified, true);
  // A row that names nobody is passed through as the same object.
  const circle = bundledAssets('testnet').find((a) => a.code === 'USDC')!;
  assert.equal(withoutProviderNames(circle), circle);
});

test('a verified entry either publishes a domain or is one we integrate with', () => {
  // The invariant behind `issuerDomain`: it is the issuer's own on-chain
  // home_domain, never a third party's attribution. USDT0 and BlindPay publish
  // none, so they are empty here rather than carrying a domain a user could not
  // verify from the ledger.
  const empty = Object.values(BUNDLED_ASSETS)
    .flat()
    .filter((a) => a.verified && a.issuer && !a.issuerDomain)
    .map((a) => a.code);
  assert.deepEqual(empty.sort(), ['USDB', 'USDT0']);
});

test('issuers are well-formed Stellar account ids', () => {
  // A malformed issuer type-checks, ships, and produces an asset nobody can hold.
  // The dashboard carried one for months: 56 characters, right prefix, invalid.
  for (const asset of Object.values(BUNDLED_ASSETS).flat()) {
    if (asset.issuer === null) continue;
    assert.match(asset.issuer, /^G[A-Z2-7]{55}$/, `${asset.code} has a malformed issuer`);
  }
});

test('no (network, code, issuer) pair is listed twice', () => {
  for (const [network, list] of Object.entries(BUNDLED_ASSETS)) {
    const keys = list.map((a) => `${a.code}:${a.issuer ?? ''}`);
    assert.equal(new Set(keys).size, keys.length, `${network} has a duplicate entry`);
  }
});
