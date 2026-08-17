/**
 * Asset identity. The regression: a bare code was treated as an identifier, so with
 * two "USDC" trustlines the order Horizon returned them in decided which issuer the
 * user paid — the standard Stellar look-alike scam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetKey, codeIsAmbiguous, findAsset, isNativeRef, isSameAsset, shortIssuer, toPaymentAsset, XLM } from '@/lib/asset';

const REAL_USDC = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const FAKE_USDC = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const balances = [
  { code: 'XLM', issuer: null, balance: '100' },
  { code: 'USDC', issuer: FAKE_USDC, balance: '999999' }, // listed FIRST on purpose
  { code: 'USDC', issuer: REAL_USDC, balance: '25' },
];

test('the key includes the issuer', () => {
  assert.equal(assetKey({ code: 'XLM', issuer: null }), 'XLM');
  assert.equal(assetKey({ code: 'USDC', issuer: REAL_USDC }), `USDC:${REAL_USDC}`);
  assert.notEqual(assetKey({ code: 'USDC', issuer: REAL_USDC }), assetKey({ code: 'USDC', issuer: FAKE_USDC }));
});

test('two assets sharing a code are NOT the same asset', () => {
  assert.ok(!isSameAsset({ code: 'USDC', issuer: REAL_USDC }, { code: 'USDC', issuer: FAKE_USDC }));
  assert.ok(isSameAsset({ code: 'USDC', issuer: REAL_USDC }, { code: 'USDC', issuer: REAL_USDC }));
  assert.ok(!isSameAsset(null, null));
});

test('findAsset returns the exact issuer, not the first code match', () => {
  const picked = findAsset(balances, { code: 'USDC', issuer: REAL_USDC });
  assert.equal(picked?.issuer, REAL_USDC);
  assert.equal(picked?.balance, '25'); // NOT the 999999 look-alike listed first
  assert.equal(findAsset(balances, { code: 'USDC', issuer: 'GNOPE' }), undefined);
});

test('ambiguity is detected so the UI can show the issuer', () => {
  assert.ok(codeIsAmbiguous(balances, 'USDC'));
  assert.ok(!codeIsAmbiguous(balances, 'XLM'));
});

test('native detection and payment-asset conversion', () => {
  assert.ok(isNativeRef(XLM));
  assert.ok(!isNativeRef({ code: 'USDC', issuer: REAL_USDC }));
  // sendPayment takes null for native.
  assert.equal(toPaymentAsset(XLM), null);
  assert.deepEqual(toPaymentAsset({ code: 'USDC', issuer: REAL_USDC }), { code: 'USDC', issuer: REAL_USDC });
  // A code with no issuer is not a credit asset.
  assert.equal(toPaymentAsset({ code: 'USDC', issuer: null }), null);
});

test('shortIssuer keeps both ends so two issuers can be compared', () => {
  const s = shortIssuer(REAL_USDC);
  assert.ok(s.startsWith('GA5Z'));
  assert.ok(s.endsWith('KZVN'));
  assert.equal(shortIssuer(null), '');
});
