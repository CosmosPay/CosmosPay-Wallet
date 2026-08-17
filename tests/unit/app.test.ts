import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_SCREENS, SPLASH_REVEAL_MS, SPLASH_DONE_MS, DAPP_MIRROR_KEY, APPROVE_TITLES } from '@/constants/app';

test('the navigation table lists every bottom-nav screen', () => {
  assert.deepEqual(NAV_SCREENS, ['home', 'earn', 'markets', 'profile', 'swap']);
  // every tab in the nav model is present
  for (const s of ['home', 'earn', 'markets', 'profile', 'swap']) assert.ok(NAV_SCREENS.includes(s));
});

test('splash timing is coherent (reveal before done, 800ms apart)', () => {
  assert.equal(SPLASH_DONE_MS - SPLASH_REVEAL_MS, 800);
  assert.ok(SPLASH_REVEAL_MS > 0);
});

test('approval window titles cover every request method', () => {
  assert.deepEqual(Object.keys(APPROVE_TITLES).sort(), ['getAddress', 'requestPayment', 'signMessage', 'signTransaction']);
  for (const v of Object.values(APPROVE_TITLES)) assert.ok(v.length > 0);
});

test('the dapp mirror key is the shared literal', () => {
  assert.equal(DAPP_MIRROR_KEY, 'cosmos.dapp');
});
