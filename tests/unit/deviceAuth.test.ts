/**
 * The device-unlock failure map.
 *
 * Two of these cases decide whether the wallet stays shut, so they are worth a test
 * rather than a manual pass on five phones: a dismissed prompt must not read as a
 * fault, and a changed enrolment must read as `'stale'` — which is what makes
 * `lib/deviceAuth.ts` drop the enrolment instead of offering a button that can only
 * ever fail again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeviceAuthError,
  deviceAuthDetail,
  deviceAuthEnabled,
  deviceAuthFailure,
  deviceAuthFailureKey,
  deviceAuthKindKey,
  deviceAuthPossible,
  deviceAuthTier,
  type DeviceAuthFailure,
  type DeviceAuthKind,
} from '@/lib/deviceAuth';
import { T } from '@/lib/i18n';

/** What the Capacitor bridge actually rejects with: `code` arrives as a STRING. */
const pluginError = (code: number) => Object.assign(new Error('platform prose, varies by OS'), { code: String(code) });

test('a dismissed prompt is a decision, not a failure', () => {
  // 16 user cancel, 11 app cancel, 15 system cancel, 17 user chose the fallback.
  for (const code of [11, 15, 16, 17]) {
    assert.equal(deviceAuthFailure(pluginError(code)), 'cancelled', `code ${code}`);
  }
});

test('a changed enrolment is "stale", which is what disables the feature', () => {
  assert.equal(deviceAuthFailure(pluginError(21)), 'stale');
});

test('the three "you can fix this" cases stay distinct', () => {
  assert.equal(deviceAuthFailure(pluginError(1)), 'noHardware');
  assert.equal(deviceAuthFailure(pluginError(3)), 'notEnrolled');
  assert.equal(deviceAuthFailure(pluginError(14)), 'noPasscode');
});

test('a permanent lockout is not the 30-second one — only one of them says "wait"', () => {
  assert.equal(deviceAuthFailure(pluginError(2)), 'lockedOut');
  assert.equal(deviceAuthFailure(pluginError(4)), 'lockedOutTemporary');
});

test('a numeric code works too — the bridge is not the only caller', () => {
  assert.equal(deviceAuthFailure({ code: 21 }), 'stale');
});

test('anything unrecognised fails closed as a plain failure, never as success', () => {
  assert.equal(deviceAuthFailure(pluginError(999)), 'failed');
  assert.equal(deviceAuthFailure(new Error('no code at all')), 'failed');
  assert.equal(deviceAuthFailure(null), 'failed');
  assert.equal(deviceAuthFailure(undefined), 'failed');
  assert.equal(deviceAuthFailure({ code: 'not a number' }), 'failed');
});

test('a DeviceAuthError carries its own verdict through unchanged', () => {
  assert.equal(deviceAuthFailure(new DeviceAuthError('notEnrolled')), 'notEnrolled');
});

/* --------------------------- copy, not prose --------------------------- */

const FAILURES: DeviceAuthFailure[] = [
  'unsupported',
  'noHardware',
  'notEnrolled',
  'noPasscode',
  'lockedOut',
  'lockedOutTemporary',
  'cancelled',
  'stale',
  'failed',
];

const KINDS: DeviceAuthKind[] = ['face', 'fingerprint', 'iris', 'multiple', 'passcode', 'generic'];

test('every failure maps to a key that exists in all five languages', () => {
  for (const f of FAILURES) {
    const key = deviceAuthFailureKey(f);
    assert.ok(T[key], `${f} -> ${key} is missing from the string table`);
    for (const lang of ['es', 'en', 'pt', 'de', 'fr'] as const) {
      assert.ok(T[key][lang], `${key} has no ${lang}`);
    }
  }
});

test('every method name maps to a key that exists in all five languages', () => {
  for (const k of KINDS) {
    const key = deviceAuthKindKey(k);
    assert.ok(T[key], `${k} -> ${key} is missing from the string table`);
    for (const lang of ['es', 'en', 'pt', 'de', 'fr'] as const) {
      assert.ok(T[key][lang], `${key} has no ${lang}`);
    }
  }
});

test('distinct failures get distinct messages — the map is not a decorated default', () => {
  const keys = FAILURES.map(deviceAuthFailureKey);
  assert.equal(new Set(keys).size, keys.length);
});

/* ------------------------- off the phone build ------------------------- */

test('anywhere that is not the phone build, the feature is simply absent', async () => {
  // node:test has no `window`, so buildKind() reports 'web' — the same answer the
  // extension gets. Nothing may claim an enrolment there, and nothing may reach for
  // the plugin: these calls must resolve, not throw on a missing native bridge.
  assert.equal(deviceAuthPossible(), false);
  assert.equal(await deviceAuthEnabled('any-wallet-id'), false);
  assert.equal(await deviceAuthTier('any-wallet-id'), null);
});

/* ------------------- the detail behind an unclassified code ------------------ */

/**
 * Three different native faults all arrive as code 0, and the one that actually bit
 * — a Keystore refusing to create the bound key — has nothing to do with the user's
 * finger. Without the detail the screen said "couldn't verify your identity" and
 * there was no way, from the app, to tell which of the three had happened.
 */
test('code 0 is unclassified, so the platform sentence is what carries the meaning', () => {
  const cryptoUnavailable = Object.assign(new Error('Biometric crypto object unavailable'), { code: '0' });
  assert.equal(deviceAuthFailure(cryptoUnavailable), 'failed');
  assert.equal(deviceAuthDetail(cryptoUnavailable), 'Biometric crypto object unavailable');
});

test('the detail survives being wrapped in a DeviceAuthError', () => {
  const wrapped = new DeviceAuthError('failed', 'Failed to decrypt credentials: key invalidated');
  assert.equal(deviceAuthDetail(wrapped), 'Failed to decrypt credentials: key invalidated');
});

test('a classified failure carries no detail to append', () => {
  assert.equal(deviceAuthDetail(new DeviceAuthError('notEnrolled')), null);
});

test('an empty or absent message is null, not an empty parenthesis on screen', () => {
  assert.equal(deviceAuthDetail({ code: '0', message: '   ' }), null);
  assert.equal(deviceAuthDetail({ code: '0' }), null);
  assert.equal(deviceAuthDetail(null), null);
});
