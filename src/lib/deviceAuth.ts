/**
 * Unlocking with the phone's own authentication — fingerprint, face, or the
 * device PIN/pattern/password. Phone build only.
 *
 * Not "biometrics": the wallet uses whatever the device can actually prove, and a
 * phone with no enrolled fingerprint but a lock screen still gets the feature. The
 * two are not equally strong, so the module picks a TIER at enrolment and records
 * which one it used (see `DeviceAuthTier`), rather than probing again at unlock
 * and silently sliding from one to the other.
 *
 * Either way the device check does NOT replace the password: it wraps it. A
 * 32-byte random key is generated at enrolment, the app password is sealed under
 * it with the same AES-GCM/PBKDF2 scheme as the vault itself (`lib/crypto.ts`),
 * and only that wrapping key goes to the OS secure store:
 *
 *   cosmos.auth.<id>      -> { tier, SealedBox(password) }   normal storage
 *   cosmos.auth.key.<id>  -> the wrapping key                Keystore / Keychain
 *
 * Splitting them is the point. The sealed box sits in SharedPreferences where a
 * rooted device can read it, and it decrypts to nothing without the key. The
 * vault's own seal is untouched either way — this is a second door to the same
 * password, never a way around it.
 *
 * Nothing here runs off the phone. `deviceAuthPossible()` gates every entry point,
 * so the MV3 popup and the web build never take the dynamic import and never ship
 * the plugin — an extension has no lock-screen hardware to reach.
 */
import { open, seal, toBase64, type SealedBox } from '@/lib/crypto';
import { buildKind } from '@/lib/platform';
import { storageGet, storageRemove, storageSet } from '@/lib/storage';

/** Sealed app password + the tier it was sealed under. See the header. */
const envelopeKey = (walletId: string) => `cosmos.auth.${walletId}`;
/** Wrapping key, in the OS secure store under the plugin's own namespace. */
const secureKey = (walletId: string) => `cosmos.auth.key.${walletId}`;

const WRAP_KEY_BYTES = 32;
/** Android caps this at 5. Three is enough for a wet finger without stalling a thief. */
const MAX_ATTEMPTS = 3;

/**
 * The plugin's enums, mirrored as plain numbers.
 *
 * Imported as values they would drag the plugin module into every bundle, and the
 * extension build must not carry a native plugin it can never call. `import type`
 * is erased, these are not, and the numbers are part of the plugin's documented
 * wire contract (`BiometricAuthError` in its README) rather than an internal
 * detail — a change to them is a breaking change on their side.
 */
const ACCESS_CONTROL_NONE = 0;
const ACCESS_CONTROL_BIOMETRY_CURRENT_SET = 1;

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
 * How the wrapping key is protected. Chosen at enrolment, stored with the envelope.
 *
 * - `'biometric'` — the key lives in a Keystore/Keychain entry that requires a live
 *   `BiometricPrompt`, bound through a `CryptoObject`. No code path can read it
 *   without a fresh check. Requires STRONG biometry: Android refuses to back a
 *   CryptoObject with a weak (Class 2) face sensor, so weak-face devices land in
 *   the tier below rather than getting a gate that only looks hardware-backed.
 * - `'passcode'` — the device check happens first and the key is read after it.
 *   The key is still encrypted at rest by the platform (Keystore-backed
 *   SharedPreferences on Android, Keychain on iOS), so another app cannot read it,
 *   but the prompt and the read are two separate calls rather than one bound
 *   operation. This is the ceiling for a PIN/pattern/password, and saying so here
 *   is better than implying both tiers are the same lock.
 */
export type DeviceAuthTier = 'biometric' | 'passcode';

/** What the device offers, for wording the button — display only, never a decision. */
export type DeviceAuthKind = 'face' | 'fingerprint' | 'iris' | 'multiple' | 'passcode' | 'generic';

/**
 * Why the device check did not work — one reason per user-facing message, same
 * shape as `CameraFailure` in `lib/camera.ts` and for the same reason: a screen
 * that folds every failure into "try again" sends a user with no enrolled
 * fingerprint to a setting that was never the problem.
 */
export type DeviceAuthFailure =
  | 'unsupported' // not the phone build, or the plugin is missing
  | 'noHardware'
  | 'notEnrolled'
  | 'noPasscode' // no lock screen at all — nothing to bind anything to
  | 'lockedOut' // too many attempts; needs the passcode to reset
  // Attempts exhausted. On the bound path that is a SINGLE unrecognised touch: the
  // plugin only forwards `maxAttempts` from verifyIdentity, so setData/getSecureData
  // run with its default of 1 and the sheet closes on the first bad read. The copy
  // has to work for that as well as for iOS's real cool-off.
  | 'lockedOutTemporary'
  | 'cancelled' // the user (or the OS) dismissed the prompt — not an error to shout about
  | 'stale' // enrolment changed, or nothing is stored: re-enable with the password
  | 'failed';

/**
 * Carries the classified reason so callers can branch without re-parsing an error.
 *
 * `detail` is the platform's own sentence, kept because three separate native
 * failures all arrive as code 0 — "Biometric crypto object unavailable", "Failed to
 * encrypt credentials", "Failed to decrypt credentials" — and the code alone cannot
 * tell them apart. Dropping it left the user with "couldn't verify your identity"
 * for a fault that had nothing to do with their finger. It is shown only for the
 * unclassified bucket, where there is nothing better to say; never used to branch.
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
 * Never matched against — CLAUDE.md's rule on `camera.ts` holds, and these strings
 * are the plugin's literals, one version bump from changing. It is carried for the
 * human reading the screen, not for the code.
 */
export function deviceAuthDetail(err: unknown): string | null {
  if (err instanceof DeviceAuthError) return err.detail;
  const msg = (err as { message?: unknown } | null)?.message;
  return typeof msg === 'string' && msg.trim() ? msg.trim() : null;
}

export interface DeviceAuthAvailability {
  /** The device can prove who this is — the only field that may drive logic. */
  available: boolean;
  /** Which protection an enrolment would get. Null when unavailable. */
  tier: DeviceAuthTier | null;
  kind: DeviceAuthKind;
  /** Why not, when `available` is false. */
  reason: DeviceAuthFailure | null;
}

const UNAVAILABLE: DeviceAuthAvailability = {
  available: false,
  tier: null,
  kind: 'generic',
  reason: 'unsupported',
};

/**
 * Is this the build that can have device authentication at all?
 *
 * The extension and the web build are not "turned off" — they have no lock screen
 * in reach, so the setting should be ABSENT rather than shown disabled. Callers use
 * this to decide whether to render anything.
 */
export function deviceAuthPossible(): boolean {
  return buildKind() === 'app';
}

type Plugin = typeof import('@capgo/capacitor-native-biometric').NativeBiometric;

/**
 * The plugin, kept inside a box — and it has to stay in one, exactly as in
 * `lib/storage.ts`.
 *
 * A Capacitor plugin is a Proxy that turns any property read into a native call,
 * `then` included. Returning the proxy from an `async function` makes the runtime
 * probe it for thenability, which calls `NativeBiometric.then()` over the bridge;
 * the bridge answers "not implemented" and the await that started it never
 * settles. A plain object is not thenable, so the proxy travels inside one. Do not
 * unwrap it here — the failure is a prompt that never appears, with no stack.
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
 * Matches on `code`, never on `message`: the message is the platform's own prose,
 * it differs between Android and iOS for the same condition, and the plugin's own
 * docs list two different strings for error 21 alone. `code` arrives as a string
 * across the Capacitor bridge, hence the `Number`.
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
    // A dismissed prompt is a decision, not a fault: the user tapping "cancel" to
    // type their password instead must not be met with a red error line.
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
function kindOf(biometryType: number, tier: DeviceAuthTier): DeviceAuthKind {
  // A device whose only proof is its lock screen says so, whatever sensor it
  // advertises: offering "unlock with your fingerprint" to a phone that answers
  // with a PIN pad is a mislabelled prompt, not a feature.
  if (tier === 'passcode' && biometryType === BIOMETRY_DEVICE_CREDENTIAL) return 'passcode';
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
    default:
      return tier === 'passcode' ? 'passcode' : 'generic';
  }
}

/**
 * What this device can do right now.
 *
 * `useFallback: true` is what makes this "the phone's authentication" rather than
 * "biometrics": a phone with a lock screen and no enrolled finger is still able to
 * prove who is holding it, and gets the feature at the `'passcode'` tier.
 *
 * The tier is decided by `strongBiometryIsAvailable`, not by `isAvailable`. Only
 * STRONG biometry can back a Keystore `CryptoObject`, so a weak (Class 2) face
 * sensor drops to `'passcode'` — the check still runs, it simply is not the bound
 * kind, and the envelope records that honestly instead of claiming otherwise.
 */
export async function deviceAuthAvailability(): Promise<DeviceAuthAvailability> {
  const box = await getPlugin();
  if (!box) return UNAVAILABLE;
  try {
    const res = await box.plugin.isAvailable({ useFallback: true });
    if (!res.isAvailable) {
      return {
        available: false,
        tier: null,
        kind: kindOf(res.biometryType, 'passcode'),
        reason: res.errorCode === undefined ? 'noHardware' : deviceAuthFailure({ code: res.errorCode }),
      };
    }
    const tier: DeviceAuthTier = res.strongBiometryIsAvailable ? 'biometric' : 'passcode';
    return { available: true, tier, kind: kindOf(res.biometryType, tier), reason: null };
  } catch (err) {
    return { available: false, tier: null, kind: 'generic', reason: deviceAuthFailure(err) };
  }
}

/** Strings for the OS prompt. Passed in because `lib/` holds no copy of its own. */
export interface DeviceAuthPrompt {
  title: string;
  subtitle?: string;
  reason: string;
  cancel: string;
}

/** What is stored next to the sealed password. `tier` is why unlock knows which path to take. */
interface AuthEnvelope {
  v: 1;
  tier: DeviceAuthTier;
  box: SealedBox;
}

async function readEnvelope(walletId: string): Promise<AuthEnvelope | null> {
  const raw = await storageGet(envelopeKey(walletId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthEnvelope;
    if (parsed?.v !== 1 || !parsed.box) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Has this wallet enrolled device authentication on this device? */
export async function deviceAuthEnabled(walletId: string): Promise<boolean> {
  if (!deviceAuthPossible()) return false;
  return (await readEnvelope(walletId)) !== null;
}

/** The tier a wallet actually enrolled under, or null when it has not. */
export async function deviceAuthTier(walletId: string): Promise<DeviceAuthTier | null> {
  if (!deviceAuthPossible()) return null;
  return (await readEnvelope(walletId))?.tier ?? null;
}

function randomWrapKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(WRAP_KEY_BYTES)));
}

/**
 * Run the device's own check. Used by the `'passcode'` tier, where the prompt is a
 * separate step, and at enrolment so turning the feature on proves the user can
 * actually pass it.
 *
 * Every authenticator the phone has is allowed. On Android `useFallback` is ignored
 * (BiometricPrompt cannot show a negative button alongside DEVICE_CREDENTIAL), so
 * the credential is requested through `allowedBiometryTypes` instead — which is
 * also why the cancel button disappears on that path and the OS back gesture is the
 * way out.
 */
async function verify(plugin: Plugin, prompt: DeviceAuthPrompt): Promise<void> {
  try {
    await plugin.verifyIdentity({
      title: prompt.title,
      subtitle: prompt.subtitle,
      reason: prompt.reason,
      negativeButtonText: prompt.cancel,
      useFallback: true,
      maxAttempts: MAX_ATTEMPTS,
      allowedBiometryTypes: [
        BIOMETRY_FINGERPRINT,
        BIOMETRY_FACE_AUTHENTICATION,
        BIOMETRY_IRIS,
        BIOMETRY_DEVICE_CREDENTIAL,
      ],
    });
  } catch (err) {
    throw new DeviceAuthError(deviceAuthFailure(err));
  }
}

/** Store the wrapping key so that only a live, cryptographically bound prompt opens it. */
async function storeBound(plugin: Plugin, walletId: string, wrapKey: string, prompt: DeviceAuthPrompt): Promise<void> {
  await plugin.setData({
    key: secureKey(walletId),
    value: wrapKey,
    accessControl: ACCESS_CONTROL_BIOMETRY_CURRENT_SET,
    // Every read gets its own prompt. A non-zero window would let any code that can
    // reach the decrypt call read the key silently until it expired.
    authValidityDuration: 0,
    title: prompt.title,
    negativeButtonText: prompt.cancel,
  });
}

/**
 * Check first, then store the key unbound. Still a real check and still the
 * fingerprint — `verify()` offers every authenticator the phone has — but the prompt
 * and the read are two calls rather than one bound operation.
 */
async function storeVerified(plugin: Plugin, walletId: string, wrapKey: string, prompt: DeviceAuthPrompt): Promise<void> {
  await verify(plugin, prompt);
  await plugin.setData({ key: secureKey(walletId), value: wrapKey, accessControl: ACCESS_CONTROL_NONE });
}

/**
 * Enrol: seal `password` under a fresh random key and hand that key to the OS.
 *
 * Order matters. The secure store is written first, because it is the half that can
 * fail — the user may dismiss the prompt shown while protecting the key. Writing
 * the envelope first would leave a wallet that reports the feature as enabled with
 * no key to open it, i.e. `'stale'` on every unlock.
 *
 * The caller must have verified `password` (the store passes the live session's,
 * which is only ever set by a successful decrypt). Sealing an unverified string
 * would enrol a password that opens nothing.
 */
export async function enableDeviceAuth(
  walletId: string,
  password: string,
  prompt: DeviceAuthPrompt,
): Promise<DeviceAuthTier> {
  const box = await getPlugin();
  if (!box) throw new DeviceAuthError('unsupported');
  const { available, tier, reason } = await deviceAuthAvailability();
  if (!available || !tier) throw new DeviceAuthError(reason ?? 'failed');

  const wrapKey = randomWrapKey();
  const sealed = await seal(password, wrapKey);
  let used: DeviceAuthTier = tier;

  try {
    if (tier === 'biometric') await storeBound(box.plugin, walletId, wrapKey, prompt);
    else await storeVerified(box.plugin, walletId, wrapKey, prompt);
  } catch (err) {
    const failure = deviceAuthFailure(err);
    const detail = deviceAuthDetail(err);
    // A dismissal, or a lockout, is an answer about the USER. Retrying at a weaker
    // tier there would quietly downgrade the lock behind someone who just said no.
    const aboutTheUser = failure === 'cancelled' || failure === 'lockedOut' || failure === 'lockedOutTemporary';
    if (tier !== 'biometric' || aboutTheUser) throw new DeviceAuthError(failure, detail);

    // Everything else at this point is the KEYSTORE refusing, not the finger. The
    // plugin swallows the real exception and returns a null CryptoObject, which
    // surfaces as code 0 — and it is permanent on the devices it happens to
    // (MIUI and ColorOS Keymasters reject setInvalidatedByBiometricEnrollment).
    // Dead-ending there meant a phone with a working fingerprint could never turn
    // the feature on and was told its identity could not be verified. Fall back to
    // the unbound tier, which still reads the same finger.
    try {
      await storeVerified(box.plugin, walletId, wrapKey, prompt);
      used = 'passcode';
    } catch (retryErr) {
      throw new DeviceAuthError(deviceAuthFailure(retryErr), deviceAuthDetail(retryErr));
    }
  }

  const envelope: AuthEnvelope = { v: 1, tier: used, box: sealed };
  await storageSet(envelopeKey(walletId), JSON.stringify(envelope));
  return used;
}

/**
 * Prompt, then return the app password.
 *
 * `'stale'` is handled rather than propagated raw: error 21 means the Keystore key
 * is gone — a changed enrolment, a restored backup, a reinstall — so the envelope
 * left behind is undecryptable forever. Clearing it here is what stops the unlock
 * screen offering a button that can only ever fail.
 */
export async function deviceAuthPassword(walletId: string, prompt: DeviceAuthPrompt): Promise<string> {
  const box = await getPlugin();
  if (!box) throw new DeviceAuthError('unsupported');
  const envelope = await readEnvelope(walletId);
  if (!envelope) throw new DeviceAuthError('stale');

  let wrapKey: string;
  try {
    if (envelope.tier === 'biometric') {
      // The prompt is implicit here: reading a BIOMETRY_CURRENT_SET entry IS the
      // authenticated operation, so there is no separate check to skip.
      const { value } = await box.plugin.getSecureData({
        key: secureKey(walletId),
        reason: prompt.reason,
        title: prompt.title,
        subtitle: prompt.subtitle,
        negativeButtonText: prompt.cancel,
      });
      wrapKey = value;
    } else {
      await verify(box.plugin, prompt);
      wrapKey = (await box.plugin.getData({ key: secureKey(walletId) })).value;
    }
  } catch (err) {
    const failure = deviceAuthFailure(err);
    if (failure === 'stale') await disableDeviceAuth(walletId);
    // NOT disabled on code 0 here, unlike enrolment: a read can fail transiently
    // (the key busy, the sheet interrupted), and wiping a working enrolment over one
    // bad read would cost the user their setup for something a retry fixes.
    throw new DeviceAuthError(failure, deviceAuthDetail(err));
  }

  try {
    return await open(envelope.box, wrapKey);
  } catch {
    // The key was read but the box did not open: the two halves are out of sync (a
    // half-finished enrolment, or storage restored from a different device).
    // Nothing here is recoverable, and leaving it would fail the same way forever.
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
    // Already gone, or the store refused. The envelope is what the app reads to
    // decide the feature is on, and it is already deleted — an orphan secure-store
    // entry decrypts nothing and is overwritten by the next enrolment.
  }
}

/**
 * Re-seal the enrolment under a new app password. Called from `vault.changePassword`.
 *
 * A fresh wrapping key rather than the old one: reading the old key needs a prompt
 * of its own, so re-using it would cost two prompts to save nothing.
 *
 * Returns false — having disabled the feature — when the wallet had no enrolment,
 * or when re-sealing failed. Refusing to leave a stale envelope is the whole job:
 * it holds the OLD password, so a wallet that changed its password and kept the old
 * envelope would hand `unlock()` a password that no longer decrypts, and the user
 * would meet "wrong password" from their own fingerprint.
 */
export async function rewrapDeviceAuth(
  walletId: string,
  newPassword: string,
  prompt: DeviceAuthPrompt,
): Promise<boolean> {
  if (!(await deviceAuthEnabled(walletId))) return false;
  try {
    await enableDeviceAuth(walletId, newPassword, prompt);
    return true;
  } catch {
    await disableDeviceAuth(walletId);
    return false;
  }
}
