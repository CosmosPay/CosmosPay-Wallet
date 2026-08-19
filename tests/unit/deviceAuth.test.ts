/**
 * The device-unlock module.
 *
 * The previous version of this file tested only the error-code lookup and the i18n key
 * maps — the two things TypeScript and `i18n.test.ts` already proved. What can actually
 * lose money here is the envelope: whether it round-trips, what it refuses, and whether
 * any of it can touch storage on a build with no secure store to hold the other half.
 * Those are what this covers now.
 *
 * `enableDeviceAuth` / `deviceAuthPassword` still need a device for their prompt-bearing
 * half, but their fail-closed guards do not, and those are tested here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeviceAuthError,
  deviceAuthDetail,
  deviceAuthEnabled,
  deviceAuthBinding,
  deviceAuthFailure,
  deviceAuthFailureKey,
  deviceAuthKindKey,
  deviceAuthPossible,
  disableDeviceAuth,
  enableDeviceAuth,
  parseAuthEnvelope,
  rewrapDeviceAuth,
  type DeviceAuthFailure,
  type DeviceAuthKind,
} from '@/lib/deviceAuth';
import { open, seal } from '@/lib/crypto';
import { T } from '@/lib/i18n';

/** What the Capacitor bridge actually rejects with: `code` arrives as a STRING. */
const pluginError = (code: number) => Object.assign(new Error('platform prose, varies by OS'), { code: String(code) });

const PROMPT = { title: 't', reason: 'r', cancel: 'c' };

/* -------------------------- classifying a rejection ------------------------- */

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

/* ------------------------------- the envelope ------------------------------ */

/**
 * The one cryptographic claim the whole design rests on: the sealed box holds the app
 * password and opens with the wrapping key alone. If this ever stops holding, the feature
 * silently becomes "the phone's lock screen IS the wallet password".
 */
test('a sealed envelope round-trips: the wrap key alone recovers the password', async () => {
  const wrapKey = 'Zm9ydHktdHdvLWJ5dGVzLW9mLXJhbmRvbW5lc3M9PQ==';
  const envelope = { v: 1 as const, binding: 'anyBiometry' as const, box: await seal('correct horse', wrapKey) };
  const parsed = parseAuthEnvelope(JSON.stringify(envelope));
  assert.ok(parsed, 'a well-formed envelope must parse');
  assert.equal(await open(parsed.box, wrapKey), 'correct horse');
});

test('the wrong wrap key does not open the envelope — it throws, it does not return junk', async () => {
  const envelope = { v: 1 as const, binding: 'anyBiometry' as const, box: await seal('correct horse', 'key-a') };
  const parsed = parseAuthEnvelope(JSON.stringify(envelope));
  assert.ok(parsed);
  await assert.rejects(() => open(parsed.box, 'key-b'));
});

test('parsing fails closed: anything malformed reads as "not enrolled", never as a usable box', async () => {
  const box = await seal('pw', 'k');
  const rejected: [string, unknown][] = [
    ['null', null],
    ['empty string', ''],
    ['not json', '{nope'],
    ['no version', JSON.stringify({ binding: 'anyBiometry', box })],
    ['a FUTURE version we cannot read', JSON.stringify({ v: 2, binding: 'anyBiometry', box })],
    ['no box', JSON.stringify({ v: 1, binding: 'anyBiometry' })],
    ['no binding', JSON.stringify({ v: 1, box })],
    ['an unknown binding', JSON.stringify({ v: 1, binding: 'whatever', box })],
  ];
  for (const [why, raw] of rejected) {
    assert.equal(parseAuthEnvelope(raw as string | null), null, why);
  }
});

/**
 * Two binding modes have shipped and this build can open neither. 'passcode' was the unbound
 * tier: its key was stored with no setUserAuthenticationRequired on Android and no
 * kSecAttrAccessible on iOS, so reading it needed no prompt at all. 'currentSet' was
 * BIOMETRY_CURRENT_SET, whose key this plugin cannot read back - getSecureData never forwards
 * accessControl and the decrypt path hardcodes 0, so the read mints a fresh key and fails the
 * GCM tag with a null-message AEADBadTagException, permanently.
 *
 * Refusing both turns a broken enrolment into "not enrolled", which the user can fix in
 * Settings. Honouring either would be a button that can only ever fail.
 */
test('envelopes from binding modes this build cannot open are refused, not migrated', async () => {
  for (const binding of ['passcode', 'currentSet']) {
    const stale = JSON.stringify({ v: 1, binding, box: await seal('pw', 'k') });
    assert.equal(parseAuthEnvelope(stale), null, binding);
  }
  // ...and the shape the old unbound build actually wrote, which used `tier`, not `binding`.
  const legacy = JSON.stringify({ v: 1, tier: 'passcode', box: await seal('pw', 'k') });
  assert.equal(parseAuthEnvelope(legacy), null);
});

/* ------------------------- off the phone build ------------------------- */

test('anywhere that is not the phone build, the feature is simply absent', async () => {
  // node:test has no `window`, so buildKind() reports 'web' — the same answer the
  // extension gets. Nothing may claim an enrolment there, and nothing may reach for the
  // plugin: these calls must resolve, not throw on a missing native bridge.
  assert.equal(deviceAuthPossible(), false);
  assert.equal(await deviceAuthEnabled('any-wallet-id'), false);
  assert.equal(await deviceAuthBinding('any-wallet-id'), null);
  await disableDeviceAuth('any-wallet-id'); // must not throw
});

/**
 * The guard rail the module's header promises and nothing enforced.
 *
 * `deviceAuthPossible()` is checked at every entry point, but `storageSet` is not gated by
 * anything — and on a non-phone build `lib/storage.ts` is localStorage. If enrolment ever
 * ran there, the sealed password would land beside the vault with NO secure store holding
 * the key that opens it, which is the one arrangement the split-storage design exists to
 * prevent.
 */
test('enrolment on a non-phone build refuses BEFORE it writes anything', async () => {
  await assert.rejects(
    () => enableDeviceAuth('w1', 'the-password', PROMPT),
    (err: unknown) => deviceAuthFailure(err) === 'unsupported',
  );
  const leaked = Object.keys(globalThis.localStorage ?? {}).filter((k) => k.startsWith('cosmos.auth.'));
  assert.deepEqual(leaked, [], 'no envelope may reach web storage');
});

test('re-wrapping a wallet that never enrolled is "none" — not a failure to report', async () => {
  assert.equal(await rewrapDeviceAuth('never-enrolled', 'new-password', PROMPT), 'none');
});

/* --------------------------- copy, not prose --------------------------- */

const FAILURES: DeviceAuthFailure[] = [
  'unsupported',
  'noHardware',
  'notEnrolled',
  'noPasscode',
  'noStrongBiometry',
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

/* ------------------- the detail behind an unclassified code ------------------ */

/**
 * Three different native faults all arrive as code 0, and the one that actually bit — a
 * Keystore refusing to create the bound key — has nothing to do with the user's finger.
 * Without the detail the screen said "couldn't verify your identity" and there was no way,
 * from the app, to tell which of the three had happened.
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
