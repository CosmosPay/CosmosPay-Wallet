/**
 * Memo rules. Two regressions here: MEMO_ID silently becoming MEMO_TEXT (an exchange
 * deposit that lands unattributed), and the 28 limit being applied to characters when
 * Stellar counts bytes (the SDK threw after the password prompt).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMO_TEXT_MAX_BYTES,
  clampMemoText,
  isValidMemoId,
  memoByteLength,
  memoKindFromSep7,
  memoProblem,
  normalizeMemo,
} from '@/lib/memo';
import { tNow } from '@/lib/i18n';

test('memo is clamped by BYTES, not characters', () => {
  const accents = 'ñ'.repeat(28); // 28 chars, 56 bytes
  assert.equal(memoByteLength(accents), 56);
  const clamped = clampMemoText(accents);
  assert.equal(memoByteLength(clamped), 28);
  assert.equal(clamped.length, 14); // only 14 of them fit
});

test('clamping never splits a character', () => {
  // Emoji are 4 bytes each: 7 fit exactly, and the 8th must not be half-emitted.
  const emoji = '🚀'.repeat(10);
  const clamped = clampMemoText(emoji);
  assert.equal(memoByteLength(clamped), 28);
  assert.equal([...clamped].length, 7);
  assert.ok(!clamped.includes('�'));
});

test('ASCII within the limit is untouched', () => {
  const s = 'orden 12345';
  assert.equal(clampMemoText(s), s);
  assert.equal(clampMemoText('x'.repeat(MEMO_TEXT_MAX_BYTES)).length, MEMO_TEXT_MAX_BYTES);
  assert.equal(clampMemoText('x'.repeat(MEMO_TEXT_MAX_BYTES + 5)).length, MEMO_TEXT_MAX_BYTES);
});

test('SEP-7 memo_type maps to a kind we can attach', () => {
  assert.equal(memoKindFromSep7('MEMO_ID'), 'id');
  assert.equal(memoKindFromSep7('memo_id'), 'id');
  assert.equal(memoKindFromSep7('MEMO_TEXT'), 'text');
  assert.equal(memoKindFromSep7(undefined), 'text');
  assert.equal(memoKindFromSep7(''), 'text');
  // We do not build these — null means "drop the memo", not "send it as text".
  assert.equal(memoKindFromSep7('MEMO_HASH'), null);
  assert.equal(memoKindFromSep7('MEMO_RETURN'), null);
});

test('MEMO_ID accepts a uint64 and nothing else', () => {
  assert.ok(isValidMemoId('0'));
  assert.ok(isValidMemoId('123456789'));
  assert.ok(isValidMemoId('18446744073709551615')); // max uint64
  assert.ok(!isValidMemoId('18446744073709551616')); // one over
  assert.ok(!isValidMemoId('-1'));
  assert.ok(!isValidMemoId('12.5'));
  assert.ok(!isValidMemoId('abc'));
  assert.ok(!isValidMemoId(''));
});

test('normalizeMemo keeps an id as an id, and degrades gracefully', () => {
  assert.deepEqual(normalizeMemo('12345', 'id'), { kind: 'id', value: '12345' });
  // A non-numeric "id" becomes text rather than being dropped: losing the reference
  // entirely is worse than sending it in the wrong field.
  assert.deepEqual(normalizeMemo('ref-9', 'id'), { kind: 'text', value: 'ref-9' });
  assert.equal(normalizeMemo('', 'text'), null);
  assert.equal(normalizeMemo('   ', 'id'), null);
});

/**
 * Asserted by KEY, never against the rendered sentence.
 *
 * `memoProblem` returns translated copy, so matching a phrase pins the test to one
 * language — and to whichever language the machine running it happens to report. Both
 * lines below used to do that, and both went red the moment CI ran them in English.
 *
 * Resolving the key through the same `tNow` the module itself calls leaves the real
 * content under test: that the RIGHT key fires, with the right params interpolated, and
 * that a valid memo yields null. Reword any of the five translations and nothing here
 * breaks; point `memoProblem` at the wrong key and this does.
 */
test('memoProblem explains a rejection', () => {
  assert.equal(memoProblem('', 'text'), null);
  assert.equal(memoProblem('corto', 'text'), null);
  // 28 two-byte characters = 56 bytes, so exactly 28 over the limit.
  assert.equal(memoProblem('ñ'.repeat(28), 'text'), tNow('memo.overByteLimit', { max: 28, over: 28 }));
  assert.equal(memoProblem('no-num', 'id'), tNow('memo.idMustBeInteger'));
});
