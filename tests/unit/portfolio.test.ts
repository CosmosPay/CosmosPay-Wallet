/**
 * Portfolio maths. The regression: the $1 stablecoin assumption was applied by CODE,
 * so a worthless look-alike "USDC" counted dollar-for-dollar toward the total — the
 * exact number a user checks to believe they were paid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePortfolio } from '@/lib/portfolio';
import type { AccountState } from '@/lib/stellar';

const REAL_USDC_PUBLIC = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const FAKE = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'; // testnet USDC issuer — wrong for mainnet

const account = (balances: AccountState['balances']): AccountState => ({
  exists: true,
  balances,
  xlm: 0,
  subentryCount: 0,
});

const prices = { XLM: { usd: 0.1, change24h: 0 } };

test('a real mainnet USDC is priced at parity', () => {
  const { total, rows } = computePortfolio(
    account([{ code: 'USDC', issuer: REAL_USDC_PUBLIC, balance: '100', isNative: false }]),
    prices,
    'public',
  );
  assert.equal(rows[0].price, 1);
  assert.equal(total, 100);
});

test('a look-alike USDC contributes NOTHING to the total', () => {
  const { total, rows } = computePortfolio(
    account([{ code: 'USDC', issuer: FAKE, balance: '999999', isNative: false }]),
    prices,
    'public',
  );
  assert.equal(rows[0].price, null); // unknown, not $1
  assert.equal(rows[0].value, null);
  assert.equal(total, 0);
  // The balance is still shown — we hide the value, not the asset.
  assert.equal(rows[0].amount, 999999);
});

test('a custom network trusts no issuer', () => {
  const { total } = computePortfolio(
    account([{ code: 'USDC', issuer: REAL_USDC_PUBLIC, balance: '100', isNative: false }]),
    prices,
    'custom-abc123',
  );
  assert.equal(total, 0);
});

test('a live price always wins over the parity assumption', () => {
  const { total } = computePortfolio(
    account([{ code: 'USDC', issuer: FAKE, balance: '10', isNative: false }]),
    { ...prices, USDC: { usd: 0.98, change24h: 0 } },
    'public',
  );
  assert.equal(Math.round(total * 100) / 100, 9.8);
});

test('the real and the fake are both listed, only one counts', () => {
  const { total, rows } = computePortfolio(
    account([
      { code: 'USDC', issuer: FAKE, balance: '1000', isNative: false },
      { code: 'USDC', issuer: REAL_USDC_PUBLIC, balance: '5', isNative: false },
    ]),
    prices,
    'public',
  );
  assert.equal(rows.length, 2);
  assert.equal(total, 5);
});

test('an unfunded account still yields the XLM row', () => {
  const { rows, total } = computePortfolio(null, prices, 'public');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'XLM');
  assert.equal(total, 0);
});
