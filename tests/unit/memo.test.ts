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
  defaultMemo,
  defaultMemoText,
  isValidMemoId,
  memoByteLength,
  memoKindFromSep7,
  memoProblem,
  normalizeMemo,
} from '@/lib/memo';
import { APP_VERSION, MEMO_SIGNATURE } from '@/constants/app';
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

/**
 * The wallet's own memo, and the one rule around it that costs real money if it is
 * ever relaxed: it fills an EMPTY field and never replaces a supplied one. A memo is
 * routinely an exchange's deposit reference, so a client that overwrote one would
 * credit somebody's deposit to nobody.
 */
test('the default memo names the wallet and its version', () => {
  const memo = defaultMemoText();
  assert.ok(memo.startsWith(`${MEMO_SIGNATURE} v`));
  // The release actually running, not a literal somebody has to remember to bump.
  assert.ok(memo.includes(APP_VERSION.split('-')[0]));
});

test('the default memo fits a text memo, prerelease versions included', () => {
  assert.ok(memoByteLength(defaultMemoText()) <= MEMO_TEXT_MAX_BYTES);
  // The suffix the release bot produces is dropped whole rather than cut by the clamp:
  // `v1.5.0-de` would read like a version and not be one.
  assert.ok(!defaultMemoText().includes('-'));
  assert.deepEqual(defaultMemo(), { kind: 'text', value: defaultMemoText() });
});

test('a supplied memo is never replaced by the default', () => {
  // normalizeMemo is what buildMemo consults first; the default is only reached when
  // this returns null. Asserted here because the branch that matters lives in
  // lib/stellar.ts, which needs the Stellar SDK and a network to exercise.
  assert.deepEqual(normalizeMemo('12345', 'id'), { kind: 'id', value: '12345' });
  assert.deepEqual(normalizeMemo('order-42', 'text'), { kind: 'text', value: 'order-42' });
  // Only an empty field falls through to it.
  assert.equal(normalizeMemo('', 'text'), null);
  assert.equal(normalizeMemo('   ', 'text'), null);
});
