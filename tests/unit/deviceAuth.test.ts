/**
 * The device-unlock module.
 *
 * The previous version of this file tested only the error-code lookup and the i18n key
 * maps — the two things TypeScript and `i18n.test.ts` already proved. What can actually
 * lose money here is the envelope: whether it round-trips, what it refuses, and whether
 * any of it can touch storage on a build with no secure store to hold the other half.
 * Those are what this covers now.
 *
 * `enableDeviceAuth` / `deviceAuthVaultKey` still need a device for their prompt-bearing
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
  reenrolDeviceAuth,
  type DeviceAuthFailure,
  type DeviceAuthKind,
} from '@/lib/deviceAuth';
import { deriveVaultKey, newKdfParams, open, seal, toBase64, type VaultKey } from '@/lib/crypto';
import { T } from '@/lib/i18n';

/**
 * What `tauri-plugin-cosmos` actually rejects with.
 *
 * An OBJECT, not a decorated Error: `src-tauri/plugins/cosmos/src/error.rs` serialises
 * `{ failure, detail }`, and a Tauri rejection arrives as that plain value rather than as
 * an `Error` instance. Building the fixture the way the bridge builds it is the point —
 * the previous shape (a numeric `code` stringified onto an Error) is what the wallet used
 * to parse, and a test that kept using it would go on passing after the contract moved.
 */
const pluginError = (failure: string, detail = 'platform prose, varies by OS') => ({ failure, detail });

const PROMPT = { title: 't', reason: 'r', cancel: 'c' };

/* -------------------------- classifying a rejection ------------------------- */

test('a dismissed prompt is a decision, not a failure', () => {
  // Both platforms fold their several dismissal codes into this one token before it ever
  // crosses the bridge — Android's ERROR_NEGATIVE_BUTTON / USER_CANCELED / CANCELED and
  // iOS's userCancel / appCancel / systemCancel / userFallback.
  assert.equal(deviceAuthFailure(pluginError('cancelled')), 'cancelled');
});

test('a changed enrolment is "stale", which is what disables the feature', () => {
  assert.equal(deviceAuthFailure(pluginError('stale')), 'stale');
});

test('the three "you can fix this" cases stay distinct', () => {
  assert.equal(deviceAuthFailure(pluginError('noHardware')), 'noHardware');
  assert.equal(deviceAuthFailure(pluginError('notEnrolled')), 'notEnrolled');
  assert.equal(deviceAuthFailure(pluginError('noPasscode')), 'noPasscode');
});

test('a permanent lockout is not the 30-second one — only one of them says "wait"', () => {
  assert.equal(deviceAuthFailure(pluginError('lockedOut')), 'lockedOut');
  assert.equal(deviceAuthFailure(pluginError('lockedOutTemporary')), 'lockedOutTemporary');
});

test('a device that cannot bind a key is not a device with no sensor', () => {
  // The distinction the whole "no unbound tier" argument rests on: `noStrongBiometry` is a
  // permanent fact about the hardware, `notEnrolled` is a trip to Settings.
  assert.equal(deviceAuthFailure(pluginError('noStrongBiometry')), 'noStrongBiometry');
  assert.notEqual(deviceAuthFailure(pluginError('noStrongBiometry')), 'notEnrolled');
});

test('anything unrecognised fails closed as a plain failure, never as success', () => {
  assert.equal(deviceAuthFailure(pluginError('somethingNewFromAFutureBuild')), 'failed');
  assert.equal(deviceAuthFailure(new Error('no token at all')), 'failed');
  assert.equal(deviceAuthFailure(null), 'failed');
  assert.equal(deviceAuthFailure(undefined), 'failed');
  assert.equal(deviceAuthFailure({ failure: 42 }), 'failed');
  // The SHAPE that used to work must not: a numeric `code` was the old plugin's contract,
  // and quietly honouring it would let a stale caller keep classifying by accident.
  assert.equal(deviceAuthFailure({ code: '21' }), 'failed');
});

test('a DeviceAuthError carries its own verdict through unchanged', () => {
  assert.equal(deviceAuthFailure(new DeviceAuthError('notEnrolled')), 'notEnrolled');
});

/* ------------------------------- the envelope ------------------------------ */

/** A key of the shape a real session carries, without paying for a real derivation. */
const someVaultKey = (): Promise<VaultKey> => deriveVaultKey('irrelevant', { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iter: 1 });

/**
 * The one cryptographic claim the whole design rests on: the sealed box holds the vault
 * KEY — never the app password — and opens with the wrapping key alone. If this ever stops
 * holding, the feature silently becomes "the phone's lock screen IS the wallet password".
 */
test('a sealed envelope round-trips: the wrap key alone recovers the vault key', async () => {
  const wrapKey = 'Zm9ydHktdHdvLWJ5dGVzLW9mLXJhbmRvbW5lc3M9PQ==';
  const vk = await someVaultKey();
  const envelope = {
    v: 2 as const,
    binding: 'boundCurrentSet' as const,
    kdf: vk.kdf,
    box: await seal(toBase64(vk.raw), wrapKey),
  };
  const parsed = parseAuthEnvelope(JSON.stringify(envelope));
  assert.ok(parsed, 'a well-formed envelope must parse');
  assert.equal(await open(parsed.box, wrapKey), toBase64(vk.raw));
  assert.deepEqual(parsed.kdf, vk.kdf, 'the parameters travel with the key or it opens nothing');
});

test('the wrong wrap key does not open the envelope — it throws, it does not return junk', async () => {
  const vk = await someVaultKey();
  const envelope = {
    v: 2 as const,
    binding: 'boundCurrentSet' as const,
    kdf: vk.kdf,
    box: await seal(toBase64(vk.raw), 'key-a'),
  };
  const parsed = parseAuthEnvelope(JSON.stringify(envelope));
  assert.ok(parsed);
  await assert.rejects(() => open(parsed.box, 'key-b'));
});

test('parsing fails closed: anything malformed reads as "not enrolled", never as a usable box', async () => {
  const box = await seal('pw', 'k');
  const kdf = newKdfParams();
  const rejected: [string, unknown][] = [
    ['null', null],
    ['empty string', ''],
    ['not json', '{nope'],
    ['no version', JSON.stringify({ binding: 'boundCurrentSet', kdf, box })],
    ['a FUTURE version we cannot read', JSON.stringify({ v: 3, binding: 'boundCurrentSet', kdf, box })],
    // v1 held the app PASSWORD, and this build refuses it rather than migrating it: see
    // the test below. It is listed here too because the shape alone is enough to reject.
    ['the version that sealed a password', JSON.stringify({ v: 1, binding: 'boundCurrentSet', box })],
    ['no box', JSON.stringify({ v: 2, binding: 'boundCurrentSet', kdf })],
    ['no binding', JSON.stringify({ v: 2, kdf, box })],
    ['an unknown binding', JSON.stringify({ v: 2, binding: 'whatever', kdf, box })],
    // Without the parameters the key was derived for, an envelope is 32 unusable bytes.
    ['no kdf', JSON.stringify({ v: 2, binding: 'boundCurrentSet', box })],
  ];
  for (const [why, raw] of rejected) {
    assert.equal(parseAuthEnvelope(raw as string | null), null, why);
  }
});

/**
 * Three binding modes have shipped and this build can open none of them.
 *
 * 'passcode' was the unbound tier: its key was stored with no setUserAuthenticationRequired
 * on Android and no kSecAttrAccessible on iOS, so reading it needed no prompt at all.
 * 'currentSet' was written by a plugin whose own read path could not open it. 'anyBiometry'
 * was genuinely bound and genuinely readable — by the PREVIOUS native half, which kept its
 * key under a secure-store namespace `tauri-plugin-cosmos` does not look at. That one is the
 * migration case: every phone that had the feature before this plugin existed lands there.
 *
 * Refusing all three turns a stale enrolment into "not enrolled", which the user fixes in
 * Settings with their password working throughout. Honouring any of them would be a button
 * that can only ever fail.
 */
test('envelopes from binding modes this build cannot open are refused, not migrated', async () => {
  const kdf = newKdfParams();
  for (const binding of ['passcode', 'currentSet', 'anyBiometry']) {
    const stale = JSON.stringify({ v: 2, binding, kdf, box: await seal('pw', 'k') });
    assert.equal(parseAuthEnvelope(stale), null, binding);
  }
  // ...and the shape the old unbound build actually wrote, which used `tier`, not `binding`.
  const legacy = JSON.stringify({ v: 2, tier: 'passcode', kdf, box: await seal('pw', 'k') });
  assert.equal(parseAuthEnvelope(legacy), null);
});

/**
 * The envelope that held the APP PASSWORD is refused the same way, and that is the whole
 * point of the version bump.
 *
 * Every `v: 1` envelope on every phone contains a copy of a string its owner very likely
 * types into other services. It cannot be migrated — nothing here can turn a password into
 * the key derived from it without the salt it was derived with, and asking for the password
 * to do so would defeat the exercise. So it is dropped: the enrolment reads as "not
 * enrolled", the user turns it back on in Settings, and what gets written the second time
 * holds no password at all.
 */
test('an envelope that sealed the app password is dropped rather than honoured', async () => {
  const v1 = JSON.stringify({ v: 1, binding: 'boundCurrentSet', box: await seal('hunter2', 'k') });
  assert.equal(parseAuthEnvelope(v1), null);
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
 * ran there, the sealed vault key would land beside the vault with NO secure store holding
 * the key that opens it, which is the one arrangement the split-storage design exists to
 * prevent.
 */
test('enrolment on a non-phone build refuses BEFORE it writes anything', async () => {
  await assert.rejects(
    async () => enableDeviceAuth('w1', await someVaultKey(), PROMPT),
    (err: unknown) => deviceAuthFailure(err) === 'unsupported',
  );
  const leaked = Object.keys(globalThis.localStorage ?? {}).filter((k) => k.startsWith('cosmos.auth.'));
  assert.deepEqual(leaked, [], 'no envelope may reach web storage');
});

test('re-enrolling never throws — a password change has already committed by then', async () => {
  // Off-phone, so `enableDeviceAuth` refuses with 'unsupported'. The contract is that the
  // refusal is reported as `false` and swallowed: `vault.changePassword` calls this AFTER
  // the vault is re-sealed, so an escaping error would abort a change nothing can undo.
  assert.equal(await reenrolDeviceAuth('never-enrolled', await someVaultKey(), PROMPT), false);
  const leaked = Object.keys(globalThis.localStorage ?? {}).filter((k) => k.startsWith('cosmos.auth.'));
  assert.deepEqual(leaked, [], 'a failed re-enrolment must leave no envelope behind');
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
 * Several distinct native faults all arrive as `failed`, and the one that actually bit — a
 * Keystore refusing to create the bound key — has nothing to do with the user's finger.
 * Without the detail the screen said "we could not verify your identity" and there was no
 * way, from inside the app, to tell which of them had happened.
 */
test('"failed" is unclassified, so the platform sentence is what carries the meaning', () => {
  const cryptoUnavailable = pluginError('failed', 'Biometric crypto object unavailable');
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

test('an empty or absent detail is null, not an empty parenthesis on screen', () => {
  assert.equal(deviceAuthDetail({ failure: 'failed', detail: '   ' }), null);
  assert.equal(deviceAuthDetail({ failure: 'failed' }), null);
  assert.equal(deviceAuthDetail(null), null);
});

test('a plain Error still yields its message — not every caller is the bridge', () => {
  // `enableDeviceAuth` logs whatever it caught, and a throw from inside the wallet
  // (a storage refusal, a serialisation fault) carries a `message` and no `detail`.
  assert.equal(deviceAuthDetail(new Error('localStorage is unavailable')), 'localStorage is unavailable');
});
