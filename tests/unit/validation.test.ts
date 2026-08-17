import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidAmount,
  isAmountWithin,
  isValidFiatAmount,
  hasAtMostSevenDecimals,
  sanitizeAmountInput,
  isWithinAmountDigitLimit,
  clampMemo,
  isValidMemo,
  isValidEmail,
  isValidName,
  isValidAssetCode,
  isValidPassword,
  hasMinLength,
  hasUppercase,
  hasDigit,
  hasLowercase,
  isValidEndpointUrl,
  isValidNetworkName,
  isValidNetworkPassphrase,
  isValidLinkCode,
  MEMO_MAX_LEN,
  PWD_MIN_LEN,
  ASSET_CODE_MAX_LEN,
} from '@/lib/validation';

test('isValidAmount accepts positive finite values', () => {
  assert.equal(isValidAmount('1'), true);
  assert.equal(isValidAmount('0.0000001'), true);
  assert.equal(isValidAmount(' 42.5 '), true);
  assert.equal(isValidAmount('0'), false);
  assert.equal(isValidAmount('-1'), false);
  assert.equal(isValidAmount('abc'), false);
  assert.equal(isValidAmount(''), false);
  assert.equal(isValidAmount('NaN'), false);
  assert.equal(isValidAmount('Infinity'), false);
});

test('isAmountWithin checks the balance bound', () => {
  assert.equal(isAmountWithin('5', 10), true);
  assert.equal(isAmountWithin('10', 10), true);
  assert.equal(isAmountWithin('10.0001', 10), false);
  assert.equal(isAmountWithin('abc', 10), false);
  assert.equal(isAmountWithin('0', 10), false);
});

test('isValidFiatAmount requires at least one minor unit (mirrors toMinor() >= 1)', () => {
  assert.equal(isValidFiatAmount('0.01'), true);
  assert.equal(isValidFiatAmount('1'), true);
  // toMinor() rounds: 0.009 -> 1 cent (passes), 0.004 -> 0 cents (fails).
  assert.equal(isValidFiatAmount('0.009'), true);
  assert.equal(isValidFiatAmount('0.004'), false);
  assert.equal(isValidFiatAmount('0'), false);
  assert.equal(isValidFiatAmount(''), false);
});

test('hasAtMostSevenDecimals caps Stellar precision', () => {
  assert.equal(hasAtMostSevenDecimals('1.1234567'), true);
  assert.equal(hasAtMostSevenDecimals('1.12345678'), false);
  assert.equal(hasAtMostSevenDecimals('123'), true);
});

test('sanitizeAmountInput cleans free-typed input', () => {
  assert.equal(sanitizeAmountInput('12,5'), '12.5');
  assert.equal(sanitizeAmountInput('1.2.3'), '1.23');
  assert.equal(sanitizeAmountInput('abc12'), '12');
  assert.equal(sanitizeAmountInput('0.123456789'), '0.1234567'); // 7-decimal cap
  assert.equal(sanitizeAmountInput('1,000'), '1.000');
});

test('isWithinAmountDigitLimit caps significant digits', () => {
  assert.equal(isWithinAmountDigitLimit('123456789012'), true);
  assert.equal(isWithinAmountDigitLimit('1234567890123'), false);
  // The 12-digit cap counts every digit (leading zeros included), like Send's input.
  assert.equal(isWithinAmountDigitLimit('0.1234567890123'), false);
  assert.equal(isWithinAmountDigitLimit('0.00000000001'), true); // exactly 12 digits
});

test('memo rules use the shared 28-byte limit', () => {
  assert.equal(MEMO_MAX_LEN, 28);
  const long = 'a'.repeat(40);
  assert.equal(clampMemo(long).length, 28);
  assert.equal(clampMemo('hi'), 'hi');
  assert.equal(isValidMemo('a'.repeat(28)), true);
  assert.equal(isValidMemo('a'.repeat(29)), false);
});

test('email predicate matches the signup contract', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('user.name+tag@example.com'), true);
  assert.equal(isValidEmail('  a@b.co  '), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(isValidEmail(''), false);
});

test('name predicate enforces 2..24 chars', () => {
  assert.equal(isValidName('Alex'), true);
  assert.equal(isValidName('  A  '), false);
  assert.equal(isValidName('A'), false);
  assert.equal(isValidName('a'.repeat(24)), true);
  assert.equal(isValidName('a'.repeat(25)), false);
});

test('asset code predicate enforces 1..12 chars', () => {
  assert.equal(isValidAssetCode('XLM'), true);
  assert.equal(isValidAssetCode('USDC'), true);
  assert.equal(isValidAssetCode('a'.repeat(12)), true);
  assert.equal(isValidAssetCode(''), false);
  assert.equal(isValidAssetCode('a'.repeat(13)), false);
  assert.equal(ASSET_CODE_MAX_LEN, 12);
});

test('password predicates reflect the policy', () => {
  assert.equal(PWD_MIN_LEN, 8);
  assert.equal(isValidPassword('Abcd1234'), true);
  assert.equal(isValidPassword('abcdefgh'), false); // no upper/digit
  assert.equal(isValidPassword('ABCDEFGH'), false); // no lower/digit
  assert.equal(isValidPassword('Abcdefgh'), false); // no digit
  assert.equal(isValidPassword('Ab1'), false); // too short
  assert.equal(hasMinLength('12345678'), true);
  assert.equal(hasUppercase('A'), true);
  assert.equal(hasDigit('1'), true);
  assert.equal(hasLowercase('a'), true);
});

test('endpoint URL predicate accepts http(s) with a host', () => {
  assert.equal(isValidEndpointUrl('https://horizon.stellar.org'), true);
  assert.equal(isValidEndpointUrl('http://localhost:8000'), true);
  assert.equal(isValidEndpointUrl('ftp://x'), false);
  assert.equal(isValidEndpointUrl('https://'), false);
  assert.equal(isValidEndpointUrl('not a url'), false);
  assert.equal(isValidNetworkName('Futurenet'), true);
  assert.equal(isValidNetworkName('F'), false);
  assert.equal(isValidNetworkPassphrase('Test SDF Future Network ; October 2022'), true);
  assert.equal(isValidNetworkPassphrase('abc'), false);
});

test('link code predicate requires exactly 6 digits', () => {
  assert.equal(isValidLinkCode('123456'), true);
  assert.equal(isValidLinkCode('12345'), false);
  assert.equal(isValidLinkCode('1234567'), false);
  assert.equal(isValidLinkCode(''), false);
});
