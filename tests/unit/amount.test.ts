/**
 * The decimal parser. Case 1 is the regression that mattered: on a Spanish keyboard
 * the fiat off-ramp read "1,50" as 1 and asked the API to move 100 cents.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDecimal,
  parseDecimalOr0,
  toMinorUnits,
  toMinorUnitsBig,
  fromMinorUnits,
  reduceByBps,
  sanitizeDecimalInput,
  STELLAR_DECIMALS,
} from '@/lib/amount';
import { toMinor } from '@/features/fiat/format';

test('toMinor reads a comma decimal the way the user typed it', () => {
  assert.equal(toMinor('1,50'), 150); // was 100 with parseFloat
  assert.equal(toMinor('1.50'), 150);
  assert.equal(toMinor('0,05'), 5);
  assert.equal(toMinor('1234,56'), 123456);
});

test('toMinorUnits is exact — no binary-float drift', () => {
  assert.equal(toMinorUnits('12.34'), 1234);
  assert.equal(toMinorUnits('1.005'), 101); // 1.005*100 is 100.49999… in float
  assert.equal(toMinorUnits('1.155'), 116);
  assert.equal(toMinorUnits('.5'), 50);
  assert.equal(toMinorUnits('7'), 700);
});

test('toMinorUnits honours a custom scale', () => {
  assert.equal(toMinorUnits('1.2345678', 7), 12345678);
});

test('parseDecimal rejects everything that is not a plain decimal', () => {
  for (const bad of ['1e3', '-1', 'abc', '', '  ', '1.2.3', '1 000', '0x10', '+2', 'Infinity', '.']) {
    assert.equal(parseDecimal(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
  assert.equal(toMinorUnits('1e3'), null);
  assert.equal(toMinorUnits('-5'), null);
});

test('parseDecimal accepts both separators and bare integers', () => {
  assert.equal(parseDecimal('1,5'), 1.5);
  assert.equal(parseDecimal('1.5'), 1.5);
  assert.equal(parseDecimal('0'), 0);
  assert.equal(parseDecimal('  12.5  '), 12.5);
  assert.equal(parseDecimalOr0('nonsense'), 0);
});

test('sanitizeDecimalInput filters keystrokes and caps the fraction', () => {
  assert.equal(sanitizeDecimalInput('1,5'), '1.5');
  assert.equal(sanitizeDecimalInput('1.2.3'), '1.23');
  assert.equal(sanitizeDecimalInput('a1b2'), '12');
  assert.equal(sanitizeDecimalInput('1.123456789'), '1.1234567'); // 7 dp for Stellar
  assert.equal(sanitizeDecimalInput('1.999', 2), '1.99'); // 2 dp for fiat
  // Over the digit budget -> null, i.e. "drop this keystroke".
  assert.equal(sanitizeDecimalInput('1234567890123'), null);
});

/* The bigint side. `toMinorUnits` returns a number, and stroops (7 decimals) pass
   Number.MAX_SAFE_INTEGER at ~900 million XLM — below Stellar's own maximum. Every
   comparison in lib/txGuard.ts that decides whether money may move uses these. */

test('toMinorUnitsBig is exact past Number.MAX_SAFE_INTEGER', () => {
  assert.equal(toMinorUnitsBig('12.34'), 1234n);
  assert.equal(toMinorUnitsBig('1.005'), 101n); // same half-up rounding as toMinorUnits
  assert.equal(toMinorUnitsBig('42.5', STELLAR_DECIMALS), 425_000_000n);
  // 922 337 203 685 XLM in stroops: exact here, lossy through a double.
  const huge = toMinorUnitsBig('922337203685.4775807', STELLAR_DECIMALS);
  assert.equal(huge, 9223372036854775807n);
  // The same value through a double loses the last three digits — which is what a
  // cap comparison would have been doing.
  assert.notEqual(String(Number(huge)), huge?.toString());
  assert.equal(toMinorUnitsBig('-1'), null);
  assert.equal(toMinorUnitsBig('1e3'), null);
});

test('fromMinorUnits is the exact inverse of the cents division it replaced', () => {
  assert.equal(fromMinorUnits(150), '1.50');
  assert.equal(fromMinorUnits(5), '0.05');
  assert.equal(fromMinorUnits(0), '0.00');
  assert.equal(fromMinorUnits(123456789), '1234567.89');
  assert.equal(fromMinorUnits(425_000_000n, STELLAR_DECIMALS), '42.5000000');
  assert.equal(fromMinorUnits(1.5), null); // minor units are integers by definition
  assert.equal(fromMinorUnits(Number.NaN), null);
  // The case that motivated it: the off-ramp bound was `sender_amount / 100`.
  assert.equal(fromMinorUnits(2_000_000_009), '20000000.09');
});

test('reduceByBps derives the floor a quote must still honour', () => {
  assert.equal(reduceByBps('100', 50), '99.5000000'); // 0.50% slippage
  assert.equal(reduceByBps('100', 0), '100.0000000');
  assert.equal(reduceByBps('100', 10_000), '0.0000000');
  assert.equal(reduceByBps('nonsense', 50), null);
  assert.equal(reduceByBps('100', -1), null);
  assert.equal(reduceByBps('100', 10_001), null);
});
