/**
 * The one number formatter. Every figure a person reads goes through it, in the language the
 * app is in: Spanish used to show "1,252.54" on Home and "4954,30" on the ramp, side by side.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberFormat } from '@/lib/numberFormat';
import { LANG_CODES } from '@/constants/i18n';

const en = numberFormat('en');
const es = numberFormat('es');
const pt = numberFormat('pt');
const de = numberFormat('de');
const fr = numberFormat('fr');
/** French groups with a narrow no-break space (U+202F), as Intl writes it. */
const NNBSP = ' ';

test('a fiat value keeps its two decimals and groups thousands in each language', () => {
  assert.equal(en.fixed(1252.54), '1,252.54');
  assert.equal(es.fixed(1252.54), '1.252,54');
  assert.equal(pt.fixed(1252.54), '1.252,54');
  assert.equal(de.fixed(1252.54), '1.252,54');
  assert.equal(fr.fixed(1252.54), `1${NNBSP}252,54`);
  // Two decimals even when the figure has none, rounded half away from zero.
  assert.equal(es.fixed(7), '7,00');
  assert.equal(en.fixed(0.125), '0.13');
  assert.equal(es.fixed(0.125, 2), '0,13');
});

test('Spanish groups a four-digit figure too (plain es/es-ES would not)', () => {
  assert.equal(es.fixed(4954.3), '4.954,30');
  assert.equal(es.amount(9983.99995, 7), '9.983,99995');
  assert.equal(es.fixed(990.86), '990,86');
});

test('a large fiat value', () => {
  assert.equal(en.usd(12345678.9), '$12,345,678.90');
  assert.equal(es.usd(12345678.9), '$12.345.678,90');
  assert.equal(pt.usd(12345678.9), '$12.345.678,90');
  assert.equal(de.usd(12345678.9), '$12.345.678,90');
  assert.equal(fr.usd(12345678.9), `$12${NNBSP}345${NNBSP}678,90`);
});

test('the dollar sign stays a bare "$" before the figure in every language', () => {
  for (const lang of LANG_CODES) {
    const s = numberFormat(lang).usd(1);
    assert.ok(s.startsWith('$1'), `${lang}: ${s}`);
    assert.ok(!/US|USD|\s\$|\$\s/.test(s), `${lang}: ${s}`);
  }
  // A price under a dollar keeps the four decimals its screens ask for.
  assert.equal(es.usd(0.0123, 4), '$0,0123');
});

test('the two-tone balance splits at the decimal mark of the language', () => {
  assert.deepEqual(en.money(1252.54), { whole: '$1,252', cents: '.54' });
  assert.deepEqual(es.money(1252.54), { whole: '$1.252', cents: ',54' });
  assert.deepEqual(de.money(0), { whole: '$0', cents: ',00' });
  assert.deepEqual(fr.money(1234567.891), { whole: `$1${NNBSP}234${NNBSP}567`, cents: ',89' });
});

test('a token amount drops trailing zeros and keeps its significant decimals', () => {
  assert.equal(en.amount(9983.99995, 7), '9,983.99995');
  assert.equal(es.amount(6.5237488, 7), '6,5237488');
  assert.equal(en.amount(10, 6), '10');
  assert.equal(de.amount(1.5, 4), '1,5');
  // Rounded to the screen's own precision.
  assert.equal(es.amount(1.23456789, 4), '1,2346');
});

test('a tiny token amount is not lost to rounding or written in exponent form', () => {
  assert.equal(en.amount(0.0000001, 7), '0.0000001');
  assert.equal(es.amount(0.0000001, 7), '0,0000001');
  assert.equal(fr.amount(0.0000001, 7), '0,0000001');
  assert.equal(es.significant(0.002231, 4), '0,002231');
  assert.equal(en.significant(0.000012345678, 4), '0.00001235');
});

test('negatives keep their sign', () => {
  assert.equal(en.fixed(-1252.5), '-1,252.50');
  assert.equal(es.fixed(-1252.5), '-1.252,50');
  assert.equal(de.amount(-0.5, 2), '-0,5');
  assert.equal(fr.fixed(-1234.5), `-1${NNBSP}234,50`);
});

test('a change is signed, with its decimal mark, and "%" stays right after it', () => {
  assert.equal(en.pct(1.234), '+1.23%');
  assert.equal(es.pct(1.234), '+1,23%');
  assert.equal(es.pct(-0.5), '-0,50%');
  assert.equal(en.pct(0), '+0.00%');
  assert.equal(de.pct(1234.5), '+1.234,50%');
});

test('a decimal string is localized digit for digit', () => {
  assert.equal(en.decimal('1234.5'), '1,234.5');
  assert.equal(es.decimal('1234.5'), '1.234,5');
  // A typed amount with a comma reads as amount.ts reads it: a decimal mark.
  assert.equal(es.decimal('1,5'), '1,5');
  assert.equal(en.decimal('1,5'), '1.5');
  // 18 decimals: no float on the way, nothing rounded.
  assert.equal(es.decimal('1234567.123456789012345678'), '1.234.567,123456789012345678');
  assert.equal(es.decimal('0.0000001'), '0,0000001');
  assert.equal(es.decimal('-0.00001'), '-0,00001');
  assert.equal(fr.decimal('1000'), `1${NNBSP}000`);
  assert.equal(es.decimal('.5'), '0,5');
  assert.equal(es.decimal('10.'), '10');
  assert.equal(es.decimal('007'), '7');
  // Trailing zeros are digits the source gave: kept.
  assert.equal(es.decimal('10.0000000'), '10,0000000');
});

test('anything that is not a plain decimal comes back untouched', () => {
  for (const s of ['', '—', 'abc', '1e-7', '1,234.5', '1.2.3', '+2', '0x10', '1 000']) {
    assert.equal(es.decimal(s), s, JSON.stringify(s));
  }
});

test('a decimal string and the same number agree in every language', () => {
  for (const lang of LANG_CODES) {
    const f = numberFormat(lang);
    for (const [s, n, dp] of [['1234567.5', 1234567.5, 7], ['999', 999, 0], ['1000', 1000, 0], ['0.25', 0.25, 2]] as const) {
      assert.equal(f.decimal(s), f.amount(n, dp), `${lang} ${s}`);
    }
  }
});

test('the formatter follows the app language, never the device locale', () => {
  // Node's own default locale is whatever the machine says; the formatter must not care.
  assert.equal(numberFormat('en').fixed(1252.54), '1,252.54');
  assert.equal(numberFormat('es').fixed(1252.54), '1.252,54');
  assert.equal(numberFormat('es').lang, 'es');
  // One instance per language.
  assert.equal(numberFormat('es'), numberFormat('es'));
});
