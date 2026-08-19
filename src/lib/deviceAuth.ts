/**
 * Unlocking with the phone's own biometrics — fingerprint, face or iris. Phone build only.
 *
 * The device check does NOT replace the password: it wraps it. A 32-byte random key is
 * generated at enrolment, the app password is sealed under it with the same
 * AES-GCM/PBKDF2 scheme as the vault itself (`lib/crypto.ts`), and only that wrapping
 * key goes to the OS secure store:
 *
 *   cosmos.auth.<id>      -> { binding, SealedBox(password) }   normal storage
 *   cosmos.auth.key.<id>  -> the wrapping key                   Keystore / Keychain
 *
 * Splitting them is the point. The sealed box sits in SharedPreferences where a rooted
 * device can read it, and it decrypts to nothing without the key. The vault's own seal
 * is untouched either way — this is a second door to the same password, never a way
 * around it.
 *
 * WHY BIOMETRICS ONLY, and why there is no PIN/pattern tier. The wrapping key is only
 * ever stored so that reading it IS an authenticated operation: on Android the Keystore
 * entry is created with `setUserAuthenticationRequired(true)` and opened through a
 * `BiometricPrompt` `CryptoObject`; on iOS the Keychain item carries a
 * `SecAccessControl` under `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`. Neither
 * platform will bind a key that way to a PIN or pattern through this plugin — Android
 * discards `DEVICE_CREDENTIAL` from the key's auth types for crypto-bound storage
 * (`BiometricAuthenticatorConfig.ensureCryptoCompatible`), and iOS's `.biometryAny` flag
 * requires enrolled biometry. The only way to include a lock-screen-only device is to
 * store the key UNBOUND (`accessControl: NONE`) and gate it with a separate
 * `verifyIdentity()` call first. That is what this module used to do, and it is not a
 * weaker version of the same lock, it is a different threat model:
 *
 *   - the unbound key's Keystore entry is generated with NO
 *     `setUserAuthenticationRequired` at all, and skips `setUnlockedDeviceRequired` on
 *     API 31-34, so on Android 12/13/14 it decrypts while the phone is locked;
 *   - the check and the read are two separate calls, so anything running in the process
 *     reaches the key by calling `getData` and never showing a prompt;
 *   - on iOS the plugin writes it with no `kSecAttrAccessible` at all, which defaults to
 *     `kSecAttrAccessibleWhenUnlocked` — backup-eligible and restorable onto a DIFFERENT
 *     device, where the envelope (in UserDefaults, also backed up) then opens with the
 *     attacker's own finger.
 *
 * A convenience feature must never become the weakest link in a spending path, so a
 * device that cannot bind the key does not get the feature. It keeps its password, which
 * works everywhere. `deviceAuthAvailability()` reports `'noStrongBiometry'` and the
 * Settings row says so.
 *
 * Nothing here runs off the phone. `deviceAuthPossible()` gates every entry point, so the
 * MV3 popup and the web build never take the dynamic import.
 *
 * They DO ship the chunk, though — one `astro build` produces all three targets and there
 * is no `rollup.external`, so the plugin's web stub sits in `dist/web` and
 * `dist/extension` unreferenced. It is not inert if anything ever reaches it: it reports
 * `strongBiometryIsAvailable: true` unconditionally and implements the secure store as a
 * `Map`, with no prompt anywhere. That is why `deviceAuthPossible()` asks
 * `Capacitor.getPlatform()` rather than only inferring the build kind from the URL.
 */
import { Capacitor } from '@capacitor/core';
import { open, seal, toBase64, type SealedBox } from '@/lib/crypto';
import { buildKind } from '@/lib/platform';
import { storageGet, storageRemove, storageSet } from '@/lib/storage';

/** Sealed app password + the binding it was sealed under. See the header. */
const envelopeKey = (walletId: string) => `cosmos.auth.${walletId}`;
/** Wrapping key, in the OS secure store under the plugin's own namespace. */
const secureKey = (walletId: string) => `cosmos.auth.key.${walletId}`;

const WRAP_KEY_BYTES = 32;

/**
 * The plugin's enums, mirrored as plain numbers.
 *
 * Imported as values they would drag the plugin module into every bundle, and the
 * extension build must not carry a native plugin it can never call. `import type` is
 * erased, these are not, and the numbers are part of the plugin's documented wire
 * contract (`AccessControl` / `BiometryType` / `BiometricAuthError` in its README)
 * rather than an internal detail — a change to them is a breaking change on their side.
 */
// BIOMETRY_CURRENT_SET (1) is deliberately unused — see DeviceAuthBinding.
const ACCESS_CONTROL_BIOMETRY_ANY = 2;

/** `BiometryType`. */
const BIOMETRY_TOUCH_ID = 1;
const BIOMETRY_FACE_ID = 2;
const BIOMETRY_FINGERPRINT = 3;
const BIOMETRY_FACE_AUTHENTICATION = 4;
const BIOMETRY_IRIS = 5;
const BIOMETRY_MULTIPLE = 6;
const BIOMETRY_DEVICE_CREDENTIAL = 7;

/** `BiometricAuthError`. */
const ERR_BIOMETRICS_UNAVAILABLE = 1;
const ERR_USER_LOCKOUT = 2;
const ERR_BIOMETRICS_NOT_ENROLLED = 3;
const ERR_USER_TEMPORARY_LOCKOUT = 4;
const ERR_AUTHENTICATION_FAILED = 10;
const ERR_APP_CANCEL = 11;
const ERR_PASSCODE_NOT_SET = 14;
const ERR_SYSTEM_CANCEL = 15;
const ERR_USER_CANCEL = 16;
const ERR_USER_FALLBACK = 17;
const ERR_NO_PROTECTED_CREDENTIALS = 21;

/**
 * How the wrapping key is protected. One value, because only one of the plugin's two
 * bound modes is actually readable again afterwards.
 *
 * `'anyBiometry'` is `accessControl: BIOMETRY_ANY` — fully bound: the Keystore entry is
 * created with `setUserAuthenticationRequired(true)` and opened per-operation through a
 * `BiometricPrompt` `CryptoObject`; on iOS it is `.biometryAny` under
 * `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`. No code path reads it without a live
 * check.
 *
 * WHY NOT `BIOMETRY_CURRENT_SET`. It looks stronger — it adds
 * `setInvalidatedByBiometricEnrollment(true)`, so a thief who learns the device PIN cannot
 * enrol their own finger and reuse the wallet's enrolment. But this plugin cannot read
 * back what it writes that way. `getSecureData` never forwards `accessControl`, and
 * `AuthActivity.createCredentialDecryptCryptoObject` calls
 * `getOrCreateCredentialKey(server, 0)` with the value hardcoded — so the read path always
 * assumes a key built WITHOUT the invalidation flag. Worse, `getOrCreateCredentialKey`
 * silently *creates* a key when the alias is missing rather than failing, so the moment the
 * OS invalidates a `CURRENT_SET` key the read mints a fresh one, `cipher.init` succeeds,
 * and `doFinal` fails the GCM tag with `AEADBadTagException` — which AOSP throws with no
 * message, surfacing as the useless "Failed to decrypt credentials: null". The user's
 * enrolment does not report itself as stale; it reports as a generic fault, forever.
 *
 * Do not add `'currentSet'` back without first checking that the plugin's read path
 * forwards `accessControl` — until it does, writing it produces an enrolment that can only
 * ever fail. Two binding values have shipped and are now refused by `readEnvelope`:
 * `'currentSet'` (unreadable, as above) and `'passcode'` (the old unbound tier). Both are
 * rejected rather than migrated, which turns a broken enrolment into "not enrolled" — a
 * state the user can recover from in Settings, with the password working throughout.
 */
export type DeviceAuthBinding = 'anyBiometry';

/** What the device offers, for wording the button — display only, never a decision. */
export type DeviceAuthKind = 'face' | 'fingerprint' | 'iris' | 'multiple' | 'passcode' | 'generic';

/**
 * Why the device check did not work — one reason per user-facing message, same shape as
 * `CameraFailure` in `lib/camera.ts` and for the same reason: a screen that folds every
 * failure into "try again" sends a user with no enrolled fingerprint to a setting that
 * was never the problem.
 */
export type DeviceAuthFailure =
  | 'unsupported' // not the phone build, or the plugin is missing
  | 'noHardware'
  | 'notEnrolled'
  | 'noPasscode' // no lock screen at all — nothing to bind anything to
  // A lock screen, but no STRONG biometrics to bind the key to: a PIN-only phone, or
  // one whose only sensor is a Class 2 face unlock. Not an error the user can clear by
  // retrying, and not one this app can work around — see the header on why there is no
  // unbound tier. Distinct from `notEnrolled`, which a trip to Settings does fix.
  | 'noStrongBiometry'
  | 'lockedOut' // too many attempts; needs the passcode to reset
  // Attempts exhausted. On this path that is a SINGLE unrecognised touch: the plugin
  // only forwards `maxAttempts` from verifyIdentity, so setData/getSecureData run with
  // its default of 1 and the sheet closes on the first bad read. The copy has to work
  // for that as well as for iOS's real cool-off.
  | 'lockedOutTemporary'
  | 'cancelled' // the user (or the OS) dismissed the prompt — not an error to shout about
  | 'stale' // enrolment changed, or nothing is stored: re-enable with the password
  | 'failed';

/**
 * Carries the classified reason so callers can branch without re-parsing an error.
 *
 * `detail` is the platform's own sentence, kept because three separate native failures
 * all arrive as code 0 — "Biometric crypto object unavailable", "Failed to encrypt
 * credentials", "Failed to decrypt credentials" — and the code alone cannot tell them
 * apart. Dropping it left the user with "couldn't verify your identity" for a fault that
 * had nothing to do with their finger. It is shown only for the unclassified bucket,
 * where there is nothing better to say; never used to branch.
 */
export class DeviceAuthError extends Error {
  readonly failure: DeviceAuthFailure;
  readonly detail: string | null;
  constructor(failure: DeviceAuthFailure, detail: string | null = null) {
    super(`deviceAuth: ${failure}${detail ? ` (${detail})` : ''}`);
    this.name = 'DeviceAuthError';
    this.failure = failure;
    this.detail = detail;
  }
}

/**
 * The platform's message, when there is one worth repeating.
 *
 * Never matched against — CLAUDE.md's rule on `camera.ts` holds, and these strings are
 * the plugin's literals, one version bump from changing. It is carried for the human
 * reading the screen, not for the code.
 */
export function deviceAuthDetail(err: unknown): string | null {
  if (err instanceof DeviceAuthError) return err.detail;
  const msg = (err as { message?: unknown } | null)?.message;
  return typeof msg === 'string' && msg.trim() ? msg.trim() : null;
}

export interface DeviceAuthAvailability {
  /** The device can bind a key to a live biometric check — the only field driving logic. */
  available: boolean;
  kind: DeviceAuthKind;
  /** Why not, when `available` is false. */
  reason: DeviceAuthFailure | null;
}

const UNAVAILABLE: DeviceAuthAvailability = { available: false, kind: 'generic', reason: 'unsupported' };

/**
 * Is this the build that can have device authentication at all?
 *
 * The extension and the web build are not "turned off" — they have no lock screen in
 * reach, so the setting should be ABSENT rather than shown disabled. Callers use this to
 * decide whether to render anything.
 */
export function deviceAuthPossible(): boolean {
  // Both checks, and `getPlatform()` is the load-bearing one. `buildKind()` decides by
  // reading `window.location.protocol` and a `window.Capacitor` shape, which is inference
  // from things a document can present; `Capacitor.getPlatform()` is the runtime's own
  // answer. It matters more here than anywhere else the helper is used, because the
  // plugin's WEB STUB ships in the same bundle as the extension and the web page — one
  // `astro build` produces all three, and there is no `rollup.external` — and that stub
  // answers `isAvailable()` with `strongBiometryIsAvailable: true` unconditionally while
  // `setData`/`getSecureData` are a bare `Map` with no prompt. Anything that reached it
  // would happily write a sealed copy of the app password into localStorage and call it
  // protected. This gate is the only thing between the two.
  try {
    const platform = Capacitor.getPlatform();
    if (platform !== 'android' && platform !== 'ios') return false;
  } catch {
    return false;
  }
  return buildKind() === 'app';
}

type Plugin = typeof import('@capgo/capacitor-native-biometric').NativeBiometric;

/**
 * The plugin, kept inside a box — and it has to stay in one, exactly as in
 * `lib/storage.ts`.
 *
 * A Capacitor plugin is a Proxy that turns any property read into a native call, `then`
 * included. Returning the proxy from an `async function` makes the runtime probe it for
 * thenability, which calls `NativeBiometric.then()` over the bridge; the bridge answers
 * "not implemented" and the await that started it never settles. A plain object is not
 * thenable, so the proxy travels inside one. Do not unwrap it here — the failure is a
 * prompt that never appears, with no stack.
 */
let boxed: { plugin: Plugin } | null = null;

async function getPlugin(): Promise<{ plugin: Plugin } | null> {
  if (!deviceAuthPossible()) return null;
  if (!boxed) {
    try {
      boxed = { plugin: (await import('@capgo/capacitor-native-biometric')).NativeBiometric };
    } catch {
      // A phone build without the native side registered (a stale `cap sync`).
      return null;
    }
  }
  return boxed;
}

/**
 * Classify a plugin rejection.
 *
 * Matches on `code`, never on `message`: the message is the platform's own prose, it
 * differs between Android and iOS for the same condition, and the plugin's own docs list
 * two different strings for error 21 alone. `code` arrives as a string across the
 * Capacitor bridge, hence the `Number`.
 */
export function deviceAuthFailure(err: unknown): DeviceAuthFailure {
  if (err instanceof DeviceAuthError) return err.failure;
  const raw = (err as { code?: unknown } | null)?.code;
  switch (Number(raw)) {
    case ERR_BIOMETRICS_UNAVAILABLE:
      return 'noHardware';
    case ERR_BIOMETRICS_NOT_ENROLLED:
      return 'notEnrolled';
    case ERR_PASSCODE_NOT_SET:
      return 'noPasscode';
    case ERR_USER_LOCKOUT:
      return 'lockedOut';
    case ERR_USER_TEMPORARY_LOCKOUT:
      return 'lockedOutTemporary';
    // A dismissed prompt is a decision, not a fault: the user tapping "cancel" to type
    // their password instead must not be met with a red error line.
    case ERR_USER_CANCEL:
    case ERR_APP_CANCEL:
    case ERR_SYSTEM_CANCEL:
    case ERR_USER_FALLBACK:
      return 'cancelled';
    case ERR_NO_PROTECTED_CREDENTIALS:
      return 'stale';
    case ERR_AUTHENTICATION_FAILED:
      return 'failed';
    default:
      return 'failed';
  }
}

/** The i18n key that explains a failure. Beside the union so a new case breaks here. */
export function deviceAuthFailureKey(failure: DeviceAuthFailure): string {
  const KEYS: Record<DeviceAuthFailure, string> = {
    unsupported: 'devAuth.errUnsupported',
    noHardware: 'devAuth.errNoHardware',
    notEnrolled: 'devAuth.errNotEnrolled',
    noPasscode: 'devAuth.errNoPasscode',
    noStrongBiometry: 'devAuth.errNoStrongBiometry',
    lockedOut: 'devAuth.errLockedOut',
    lockedOutTemporary: 'devAuth.errLockedOutTemp',
    cancelled: 'devAuth.errCancelled',
    stale: 'devAuth.errStale',
    failed: 'devAuth.errFailed',
  };
  return KEYS[failure];
}

/** The i18n key naming the method, for the button and the settings row. */
export function deviceAuthKindKey(kind: DeviceAuthKind): string {
  const KEYS: Record<DeviceAuthKind, string> = {
    face: 'devAuth.kindFace',
    fingerprint: 'devAuth.kindFingerprint',
    iris: 'devAuth.kindIris',
    multiple: 'devAuth.kindMultiple',
    passcode: 'devAuth.kindPasscode',
    generic: 'devAuth.kindGeneric',
  };
  return KEYS[kind];
}

/** Map the plugin's `BiometryType` to the wording we have. Display only. */
function kindOf(biometryType: number): DeviceAuthKind {
  switch (biometryType) {
    case BIOMETRY_FACE_ID:
    case BIOMETRY_FACE_AUTHENTICATION:
      return 'face';
    case BIOMETRY_TOUCH_ID:
    case BIOMETRY_FINGERPRINT:
      return 'fingerprint';
    case BIOMETRY_IRIS:
      return 'iris';
    case BIOMETRY_MULTIPLE:
      return 'multiple';
    // Only reachable while UNAVAILABLE: a phone whose sole authenticator is its lock
    // screen cannot bind the key, so it never gets past `deviceAuthAvailability`. The
    // wording still matters, because that is the device reading the reason it cannot.
    case BIOMETRY_DEVICE_CREDENTIAL:
      return 'passcode';
    default:
      return 'generic';
  }
}

/**
 * What this device can do right now.
 *
 * Availability is decided by `strongBiometryIsAvailable`, NOT by `isAvailable`: only
 * strong (Class 3) biometry can back a Keystore `CryptoObject`, and an unbindable key is
 * not a lock this wallet will store a password behind. A weak Class 2 face sensor and a
 * PIN-only phone both land on `'noStrongBiometry'` — see the header.
 *
 * `useFallback: false` for the same reason: asking about the lock screen would report a
 * capability this module deliberately does not use.
 */
export async function deviceAuthAvailability(): Promise<DeviceAuthAvailability> {
  const box = await getPlugin();
  if (!box) return UNAVAILABLE;
  try {
    const res = await box.plugin.isAvailable({ useFallback: false });
    if (!res.isAvailable) {
      return {
        available: false,
        kind: kindOf(res.biometryType),
        reason: res.errorCode === undefined ? 'noHardware' : deviceAuthFailure({ code: res.errorCode }),
      };
    }
    if (!res.strongBiometryIsAvailable) {
      return { available: false, kind: kindOf(res.biometryType), reason: 'noStrongBiometry' };
    }
    return { available: true, kind: kindOf(res.biometryType), reason: null };
  } catch (err) {
    return { available: false, kind: 'generic', reason: deviceAuthFailure(err) };
  }
}

/** Strings for the OS prompt. Passed in because `lib/` holds no copy of its own. */
export interface DeviceAuthPrompt {
  title: string;
  reason: string;
  cancel: string;
}

/** What is stored next to the sealed password. See `DeviceAuthBinding`. */
interface AuthEnvelope {
  v: 1;
  binding: DeviceAuthBinding;
  box: SealedBox;
}

/**
 * Parse a stored envelope, or null.
 *
 * Every rejection here turns the feature OFF for that wallet rather than throwing, which
 * is the fail-closed direction: an envelope this build cannot read is one it must not
 * act on. A future `v: 2` therefore needs a migration written here — silently reporting
 * "not enrolled" is correct behaviour for an unknown version, but it is not a substitute
 * for one.
 */
function readEnvelope(raw: string | null): AuthEnvelope | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthEnvelope;
    if (parsed?.v !== 1 || !parsed.box) return null;
    // An allowlist, not a rejection list: an envelope whose binding this build does not
    // write is one whose key it may not be able to open, and "the feature is off" is the
    // only safe reading of that. The two values that have shipped and are refused here are
    // named in `DeviceAuthBinding` — `'currentSet'` and `'passcode'` — as prose, because a
    // constant listing them would invite filtering AGAINST it, which is the rejection list
    // this comment exists to rule out.
    if (parsed.binding !== 'anyBiometry') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Exported for tests: `readEnvelope` is the fail-closed gate and is pure over a string. */
export const parseAuthEnvelope = readEnvelope;

async function loadEnvelope(walletId: string): Promise<AuthEnvelope | null> {
  return readEnvelope(await storageGet(envelopeKey(walletId)));
}

/** Has this wallet enrolled device authentication on this device? */
export async function deviceAuthEnabled(walletId: string): Promise<boolean> {
  if (!deviceAuthPossible()) return false;
  return (await loadEnvelope(walletId)) !== null;
}

/** The binding a wallet actually enrolled under, or null when it has not. */
export async function deviceAuthBinding(walletId: string): Promise<DeviceAuthBinding | null> {
  if (!deviceAuthPossible()) return null;
  return (await loadEnvelope(walletId))?.binding ?? null;
}

function randomWrapKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(WRAP_KEY_BYTES)));
}

/**
 * Store the wrapping key so that only a live, cryptographically bound prompt opens it.
 *
 * `setData` with a non-zero `accessControl` raises the OS prompt itself and binds the key
 * to it, so there is no separate check to run first — and deliberately no
 * `verifyIdentity()` call anywhere in this module. A prompt that is not the same operation
 * as the read is a prompt the read does not need.
 *
 * DELETE FIRST, ALWAYS — and it is re-enrolment that needs it, not enrolment. The plugin's
 * `getOrCreateCredentialKey` reuses an existing Keystore alias whenever the stored
 * `authValidityDuration` matches the requested one, and never compares `accessControl`.
 * Every call here passes 0, so without the delete a second enrolment for the same wallet
 * silently keeps the FIRST key and `setData` writes the new wrapping key under it. That is
 * the path a password change takes. `deleteData` removes the alias as well as the stored
 * blob, forcing a fresh `buildCredentialKey`.
 *
 * The cost of deleting first is that the previous enrolment is gone before the replacement
 * exists — so a refusal here leaves the wallet with no key, which is why `enableDeviceAuth`
 * removes the envelope on its way out. Fail closed in that direction on purpose: the
 * alternative is an envelope whose key belongs to a superseded password.
 */
async function storeBound(
  plugin: Plugin,
  walletId: string,
  wrapKey: string,
  accessControl: number,
  prompt: DeviceAuthPrompt,
): Promise<void> {
  // A missing alias is not an error — on a first enrolment there is nothing to remove.
  await plugin.deleteData({ key: secureKey(walletId) }).catch(() => {});
  await plugin.setData({
    key: secureKey(walletId),
    value: wrapKey,
    accessControl,
    // Every read gets its own prompt. A non-zero window would let any code that can
    // reach the decrypt call read the key silently until it expired.
    authValidityDuration: 0,
    title: prompt.title,
    negativeButtonText: prompt.cancel,
  });
}

/**
 * Enrol: seal `password` under a fresh random key and hand that key to the OS.
 *
 * Order matters. The secure store is written first, because it is the half that can fail
 * — the user may dismiss the prompt shown while protecting the key. Writing the envelope
 * first would leave a wallet that reports the feature as enabled with no key to open it,
 * i.e. `'stale'` on every unlock.
 *
 * The caller must have verified `password` (the store passes the live session's, which is
 * only ever set by a successful decrypt). Sealing an unverified string would enrol a
 * password that opens nothing.
 *
 * ONE RUNG. `BIOMETRY_ANY` is the only `accessControl` this plugin can both write and read
 * back — see `DeviceAuthBinding` for why `BIOMETRY_CURRENT_SET` produces a key its own read
 * path cannot open. It is still fully bound; what it gives up is
 * `setInvalidatedByBiometricEnrollment`, which the read path structurally cannot support.
 *
 * If it refuses, so do we. This used to fall through to an unbound key, which put the
 * wrapping key one prompt-free native call away from anything running in the process, and
 * on iOS put it in a restorable backup. A device that cannot bind the key keeps its
 * password instead.
 */
export async function enableDeviceAuth(
  walletId: string,
  password: string,
  prompt: DeviceAuthPrompt,
): Promise<DeviceAuthBinding> {
  const box = await getPlugin();
  if (!box) throw new DeviceAuthError('unsupported');
  const { available, reason } = await deviceAuthAvailability();
  if (!available) throw new DeviceAuthError(reason ?? 'failed');

  const wrapKey = randomWrapKey();
  const sealed = await seal(password, wrapKey);

  try {
    await storeBound(box.plugin, walletId, wrapKey, ACCESS_CONTROL_BIOMETRY_ANY, prompt);
  } catch (err) {
    const failure = deviceAuthFailure(err);
    const detail = deviceAuthDetail(err);
    // Drop any envelope this wallet still had. `storeBound` deletes the Keystore alias
    // before it writes, so a failure here has already destroyed the key an EARLIER
    // enrolment was using — and leaving that wallet's old envelope behind means the app
    // still reports the feature as on while nothing can open it. Not hypothetical: the
    // re-enrolment path of a password change lands here every time the user dismisses the
    // prompt. Removing it makes the outcome "not enrolled", which Settings can fix.
    await storageRemove(envelopeKey(walletId)).catch(() => {});
    // Logged as well as thrown: this class of fault arrives as code 0 with a message that
    // is frequently the literal string "null", because AOSP's AndroidKeyStore throws
    // `IllegalBlockSizeException` / `AEADBadTagException` with no message and the plugin
    // drops the cause. logcat still has the Keymaster's own error code; the app never does.
    // The failure and the detail only — never `password`, never `wrapKey`.
    console.warn('deviceAuth: BIOMETRY_ANY refused, refusing to enrol —', failure, detail);
    throw new DeviceAuthError(failure, detail);
  }

  const envelope: AuthEnvelope = { v: 1, binding: 'anyBiometry', box: sealed };
  await storageSet(envelopeKey(walletId), JSON.stringify(envelope));
  return 'anyBiometry';
}

/**
 * Prompt, then return the app password.
 *
 * The prompt is implicit: reading a bound entry IS the authenticated operation, so there
 * is no separate check that could be skipped, and no window in which the key is readable
 * without one.
 *
 * `'stale'` is handled rather than propagated raw: error 21 means the Keystore key is
 * gone — a changed enrolment, a restored backup, a reinstall — so the envelope left
 * behind is undecryptable forever. Clearing it here is what stops the unlock screen
 * offering a button that can only ever fail.
 */
export async function deviceAuthPassword(walletId: string, prompt: DeviceAuthPrompt): Promise<string> {
  const box = await getPlugin();
  if (!box) throw new DeviceAuthError('unsupported');
  const envelope = await loadEnvelope(walletId);
  if (!envelope) throw new DeviceAuthError('stale');

  let wrapKey: string;
  try {
    const { value } = await box.plugin.getSecureData({
      key: secureKey(walletId),
      reason: prompt.reason,
      title: prompt.title,
      negativeButtonText: prompt.cancel,
    });
    wrapKey = value;
  } catch (err) {
    const failure = deviceAuthFailure(err);
    if (failure === 'stale') await disableDeviceAuth(walletId);
    // NOT disabled on code 0 here, unlike enrolment: a read can fail transiently (the
    // key busy, the sheet interrupted), and wiping a working enrolment over one bad read
    // would cost the user their setup for something a retry fixes.
    throw new DeviceAuthError(failure, deviceAuthDetail(err));
  }

  try {
    return await open(envelope.box, wrapKey);
  } catch {
    // The key was read but the box did not open: the two halves are out of sync (a
    // half-finished enrolment, or storage restored from a different device). Nothing
    // here is recoverable, and leaving it would fail the same way forever.
    await disableDeviceAuth(walletId);
    throw new DeviceAuthError('stale');
  }
}

/** Forget the enrolment: both halves, in the order that cannot leave a usable one. */
export async function disableDeviceAuth(walletId: string): Promise<void> {
  await storageRemove(envelopeKey(walletId));
  const box = await getPlugin();
  if (!box) return;
  try {
    await box.plugin.deleteData({ key: secureKey(walletId) });
  } catch {
    // Already gone, or the store refused. The envelope is what the app reads to decide
    // the feature is on, and it is already deleted — an orphan secure-store entry
    // decrypts nothing and is overwritten by the next enrolment.
  }
}

/**
 * Enrol again under a new app password, for `vault.changePassword` to inject
 * (`ChangePasswordDeps`) so that function owns no prompt copy.
 *
 * A fresh wrapping key rather than the old one: reading the old key needs a prompt of its
 * own, so re-using it would cost two prompts to save nothing.
 *
 * It takes no view on whether the wallet WAS enrolled, and that is the change that made
 * the ordering in `changePassword` safe. This used to be `rewrapDeviceAuth`, which read
 * `deviceAuthEnabled` itself and ran after the vault had already moved — so an interrupted
 * pass left an envelope holding the superseded password. The caller now drops every
 * enrolment before it commits and calls this afterwards with the list it captured; a
 * function that decides for itself cannot be sequenced that way.
 *
 * Never throws: the password change it belongs to has already committed by the time this
 * runs, so an escaping error would abort a change that cannot be undone. `false` means the
 * enrolment is off and the user has to turn it back on — which is also what happens when
 * they dismiss the prompt, and is a perfectly good outcome. Fail closed: no enrolment beats
 * one that opens nothing.
 */
export async function reenrolDeviceAuth(
  walletId: string,
  newPassword: string,
  prompt: DeviceAuthPrompt,
): Promise<boolean> {
  try {
    await enableDeviceAuth(walletId, newPassword, prompt);
    return true;
  } catch {
    try {
      await disableDeviceAuth(walletId);
    } catch {
      // Storage refused. The envelope may survive, but `enableDeviceAuth` already removed
      // it on its own failure path, and an envelope with no Keystore key reads as 'stale'
      // on the next attempt — which turns itself off. Nothing here is worth throwing over.
    }
    return false;
  }
}
