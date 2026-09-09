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
const TETHER_USDT0 = 'GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q';
/* One of the eight accounts squatting the USDT0 code on mainnet. */
const FAKE_USDT0 = 'GBL35PWBKAHURS7SMATHXTS5X57BHC23P2B6MOJTDXTDKD7K25QHUSDT';

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

/**
 * USDT0 has no CoinGecko entry, so parity is the ONLY way it can carry a value.
 * While the trusted-issuer check read a second hand-maintained table that had never
 * heard of it, a user holding Tether's Stellar token saw the row and a total that
 * ignored it — which reads as "my money is gone" on the number people check after
 * being paid. It now reads the same registry the token picker does.
 */
test('a real mainnet USDT0 is priced at parity', () => {
  const { total, rows } = computePortfolio(
    account([{ code: 'USDT0', issuer: TETHER_USDT0, balance: '250', isNative: false }]),
    prices,
    'public',
  );
  assert.equal(rows[0].price, 1);
  assert.equal(total, 250);
});

test('a look-alike USDT0 contributes NOTHING to the total', () => {
  const { total, rows } = computePortfolio(
    account([{ code: 'USDT0', issuer: FAKE_USDT0, balance: '999999', isNative: false }]),
    prices,
    'public',
  );
  assert.equal(rows[0].price, null);
  assert.equal(total, 0);
});

test('a LISTED but unverified issuer gets no parity assumption', () => {
  // The registry names NTokens' BRL without vouching for who runs it. Being in the
  // catalog is not the same claim as being verified, and only the second one may
  // license a statement about what a balance is worth.
  const { rows } = computePortfolio(
    account([{ code: 'BRL', issuer: 'GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP', balance: '100', isNative: false }]),
    prices,
    'public',
  );
  assert.equal(rows[0].price, null);
});
