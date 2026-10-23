/**
 * The max-slippage choice (`lib/slippage.ts`). It is the one number of a swap the person sets
 * directly, so what reaches the gateway must stay in range however it got there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampSlippageBps, isHighSlippage, parseSlippagePref, slippageFor, stepSlippage } from '@/lib/slippage';
import { SLIPPAGE_MAX_BPS, SLIPPAGE_MIN_BPS, SLIPPAGE_PRESETS_BPS, SLIPPAGE_WARN_BPS } from '@/constants/swap';

test('a choice is clamped to the sheet’s range and to whole basis points', () => {
  assert.equal(clampSlippageBps(0), SLIPPAGE_MIN_BPS);
  assert.equal(clampSlippageBps(-50), SLIPPAGE_MIN_BPS);
  assert.equal(clampSlippageBps(10_000), SLIPPAGE_MAX_BPS);
  assert.equal(clampSlippageBps(74.6), 75);
  assert.equal(clampSlippageBps(Number.NaN), SLIPPAGE_MIN_BPS);
});

test('a stored value nobody could have chosen reads as auto, not as a rounded choice', () => {
  assert.equal(parseSlippagePref(null), null);
  assert.equal(parseSlippagePref(''), null);
  assert.equal(parseSlippagePref('abc'), null);
  assert.equal(parseSlippagePref('1.5'), null);
  assert.equal(parseSlippagePref('5000'), null);
  assert.equal(parseSlippagePref('0'), null);
  assert.equal(parseSlippagePref('100'), 100);
  for (const p of SLIPPAGE_PRESETS_BPS) assert.equal(parseSlippagePref(String(p)), p);
});

test('the stepper moves 0.1% below 1% and 0.5% from 1% up, and stops at the bounds', () => {
  assert.equal(stepSlippage(50, 1), 60);
  assert.equal(stepSlippage(90, 1), 100);
  assert.equal(stepSlippage(100, 1), 150);
  assert.equal(stepSlippage(150, -1), 100);
  assert.equal(stepSlippage(100, -1), 90);
  assert.equal(stepSlippage(250, 1), 300);
  assert.equal(stepSlippage(SLIPPAGE_MIN_BPS, -1), SLIPPAGE_MIN_BPS);
  assert.equal(stepSlippage(SLIPPAGE_MAX_BPS, 1), SLIPPAGE_MAX_BPS);
});

test('no choice keeps the venue’s own default', () => {
  assert.equal(slippageFor(null, 50), 50);
  assert.equal(slippageFor(250, 50), 250);
});

test('the warning starts at the threshold and no preset below it trips it', () => {
  assert.equal(isHighSlippage(SLIPPAGE_WARN_BPS), true);
  assert.equal(isHighSlippage(SLIPPAGE_WARN_BPS - 1), false);
  for (const p of SLIPPAGE_PRESETS_BPS) assert.equal(isHighSlippage(p), false);
});
