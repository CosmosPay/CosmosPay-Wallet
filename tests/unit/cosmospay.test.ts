import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUnsignedXdr, blindpayNetwork, usdcIssuer, makeNonce, DEFAULT_SLIPPAGE_BPS } from '@/lib/cosmospay';

const XDR_LIKE = 'AAAAAgAAAAB'.padEnd(60, 'A');

test('extractUnsignedXdr finds the unsigned XDR across BlindPay field names', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ transaction_hash: XDR_LIKE }, XDR_LIKE],
    [{ unsigned_transaction: XDR_LIKE }, XDR_LIKE],
    [{ data: { unsignedTransaction: XDR_LIKE } }, XDR_LIKE], // one level of nesting
    [{ result: { payout: { xdr: XDR_LIKE } } }, XDR_LIKE],
  ];
  for (const [obj, want] of cases) assert.equal(extractUnsignedXdr(obj), want);
});

test('extractUnsignedXdr ignores short strings and non-objects', () => {
  assert.equal(extractUnsignedXdr(null), null);
  assert.equal(extractUnsignedXdr('string'), null);
  assert.equal(extractUnsignedXdr({ transaction_hash: 'short' }), null); // < 40 chars
  assert.equal(extractUnsignedXdr({}), null);
});

test('blindpayNetwork maps dev to testnet and prod to mainnet', () => {
  assert.equal(blindpayNetwork('dev'), 'stellar_testnet');
  assert.equal(blindpayNetwork('prod'), 'stellar');
});

test('usdcIssuer resolves per network id', () => {
  assert.ok(usdcIssuer('public')?.startsWith('G'));
  assert.ok(usdcIssuer('testnet')?.startsWith('G'));
  assert.equal(usdcIssuer('custom'), undefined);
});

test('makeNonce produces hex of the requested length', () => {
  const n = makeNonce(8);
  assert.equal(n.length, 16); // 8 bytes -> 16 hex chars
  assert.match(n, /^[0-9a-f]+$/);
  assert.notEqual(makeNonce(), makeNonce()); // practically unique
});

test('default swap slippage is 0.5% (50 bps)', () => {
  assert.equal(DEFAULT_SLIPPAGE_BPS, 50);
});
