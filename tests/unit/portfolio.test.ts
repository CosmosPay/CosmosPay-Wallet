import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePortfolio } from '@/lib/portfolio';

test('empty account yields a native XLM row and zero total', () => {
  const out = computePortfolio(null, {});
  assert.equal(out.total, 0);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].code, 'XLM');
});

test('portfolio totals and sorts by value (native first)', () => {
  const account: any = {
    exists: true,
    xlm: 100,
    subentryCount: 0,
    balances: [
      { code: 'USDC', issuer: 'G', balance: '10', isNative: false },
      { code: 'XLM', issuer: null, balance: '100', isNative: true },
    ],
  };
  const prices: any = { XLM: { usd: 0.5, change24h: 0 }, USDC: { usd: 1, change24h: 0 } };
  const out = computePortfolio(account, prices);
  assert.equal(out.total, 60); // 100*0.5 + 10*1
  assert.equal(out.rows[0].code, 'XLM'); // native first
  assert.equal(out.rows[1].code, 'USDC');
});

test('stablecoins assume parity without a live price', () => {
  const account: any = {
    exists: true,
    xlm: 0,
    subentryCount: 0,
    balances: [{ code: 'USDC', issuer: 'G', balance: '25', isNative: false }],
  };
  const out = computePortfolio(account, {});
  assert.equal(out.rows[0].value, 25); // assumed $1
});

test('24h change is backed out of the previous total', () => {
  const account: any = {
    exists: true,
    xlm: 0,
    subentryCount: 0,
    balances: [{ code: 'XLM', issuer: null, balance: '110', isNative: true }],
  };
  // +10% change: previous value = 110/1.1 = 100 -> delta 10
  const out = computePortfolio(account, { XLM: { usd: 1, change24h: 10 } });
  assert.equal(Math.round(out.deltaUsd), 10);
  assert.equal(Math.round(out.changePct), 10);
});
