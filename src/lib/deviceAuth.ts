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
 * Splitting them is the point. The sealed box sits in the app's own store where a rooted
 * device can read it, and it decrypts to nothing without the key. The vault's own seal
 * is untouched either way — this is a second door to the same password, never a way
 * around it.
 *
 * WHY BIOMETRICS ONLY, and why there is no PIN/pattern tier. The wrapping key is only
 * ever stored so that reading it IS an authenticated operation: on Android the Keystore
 * entry is created with `setUserAuthenticationRequired(true)` and opened through a
 * `BiometricPrompt` `CryptoObject`; on iOS the Keychain item carries a `SecAccessControl`
 * under `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`. Neither platform will bind a
 * key that way to a PIN or pattern, and the only way to include a lock-screen-only device
 * is to store the key UNBOUND and gate it with a separate identity check first. That is
 * what this module used to do, and it is not a weaker version of the same lock, it is a
 * different threat model:
 *
 *   - an unbound Keystore entry is generated with NO `setUserAuthenticationRequired` at
 *     all, and skips `setUnlockedDeviceRequired` on API 31-34, so on Android 12/13/14 it
 *     decrypts while the phone is locked;
 *   - the check and the read are two separate calls, so anything running in the process
 *     reaches the key by calling the read and never showing a prompt;
 *   - on iOS an item written with no `kSecAttrAccessible` defaults to
 *     `kSecAttrAccessibleWhenUnlocked` — backup-eligible and restorable onto a DIFFERENT
 *     device, where the envelope (also stored, also backed up) then opens with the
 *     attacker's own finger.
 *
 * A convenience feature must never become the weakest link in a spending path, so a
 * device that cannot bind the key does not get the feature. It keeps its password, which
 * works everywhere. `deviceAuthAvailability()` reports `'noStrongBiometry'` and the
 * Settings row says so.
 *
 * Nothing here runs off the phone. `deviceAuthPossible()` gates every entry point, so the
 * MV3 popup, the web build and the desktop window never reach the bridge.
 *
 * THE NATIVE HALF IS OURS. It is `tauri-plugin-cosmos`, in this repo — see
 * `src-tauri/plugins/cosmos/src/lib.rs`. That is what makes the paragraph above true
 * rather than aspirational: a third-party plugin decides its own Keystore flags, and the
 * one this replaced hardcoded the read path in a way that made the strongest binding
 * unreadable. Both halves being in the same repo is why `binding` below can promise
 * invalidation-on-enrolment-change and be believed.
 */
import { open, seal, toBase64, type SealedBox } from '@/lib/crypto';
import { isMobileApp } from '@/lib/platform';
import { nativeInvoke } from '@/lib/nativeBridge';
import { storageGet, storageRemove, storageSet } from '@/lib/storage';

/** Sealed app password + the binding it was sealed under. See the header. */
const envelopeKey = (walletId: string) => `cosmos.auth.${walletId}`;
/** Wrapping key, in the OS secure store under the plugin's own namespace. */
const secureKey = (walletId: string) => `cosmos.auth.key.${walletId}`;

const WRAP_KEY_BYTES = 32;

/**
 * How the wrapping key is protected.
 *
 * `'boundCurrentSet'` is fully bound AND invalidated by an enrolment change: on Android
 * the Keystore key carries `setUserAuthenticationRequired(true)`, a per-USE authentication
 * policy and `setInvalidatedByBiometricEnrollment(true)`; on iOS the Keychain item is
 * `.biometryCurrentSet` under `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`. No code
 * path reads it without a live check, and a thief who learns the device PIN cannot enrol
 * their own finger and inherit the wallet — doing so destroys the key instead.
 *
 * ONE VALUE, and every value that has ever shipped is refused by `readEnvelope`:
 * `'anyBiometry'` (bound, but surviving an enrolment change — and written by the previous
 * native plugin into a store this one cannot read), `'currentSet'` (a binding the old
 * plugin could write but never read back) and `'passcode'` (the unbound tier). All three
 * are rejected rather than migrated, which turns a stale enrolment into "not enrolled" —
 * a state the user recovers from in Settings, with the password working throughout.
 *
 * That is deliberate and it is the migration: an enrolment made before the native half
 * moved to `tauri-plugin-cosmos` lives in a Keystore alias the new plugin does not look
 * at, so it could only ever fail. It fails ONCE, quietly, as "off".
 */
export type DeviceAuthBinding = 'boundCurrentSet';

/** What the device offers, for wording the button — display only, never a decision. */
export type DeviceAuthKind = 'face' | 'fingerprint' | 'iris' | 'multiple' | 'passcode' | 'generic';

/**
 * Why the device check did not work — one reason per user-facing message, same shape as
 * `CameraFailure` in `lib/camera.ts` and for the same reason: a screen that folds every
 * failure into "try again" sends a user with no enrolled fingerprint to a setting that
 * was never the problem.
 *
 * Every member is a token the native side sends verbatim. `Failure` in
 * `src-tauri/plugins/cosmos/src/models.rs` is the same list; the Kotlin and Swift halves
 * each carry it too, and the four have to agree letter for letter.
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
  | 'lockedOutTemporary' // the platform's short cool-off, cleared by waiting
  | 'cancelled' // the user (or the OS) dismissed the prompt — not an error to shout about
  | 'stale' // enrolment changed, or nothing is stored: re-enable with the password
  | 'failed';

/** Runtime membership test for the token the native side sent. */
const FAILURES: readonly DeviceAuthFailure[] = [
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

const KINDS: readonly DeviceAuthKind[] = ['face', 'fingerprint', 'iris', 'multiple', 'passcode', 'generic'];

/**
 * Carries the classified reason so callers can branch without re-parsing an error.
 *
 * `detail` is the platform's own sentence, kept because several distinct native failures
 * share one classification — "biometric crypto object unavailable", "failed to encrypt
 * credentials", a Keymaster fault with no message at all — and the classification alone
 * cannot tell them apart. Dropping it left the user with "couldn't verify your identity"
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
 * Never matched against — CLAUDE.md's rule on `camera.ts` holds, and these strings are
 * the platform's own literals, one OS update from changing. It is carried for the human
 * reading the screen, not for the code.
 */
export function deviceAuthDetail(err: unknown): string | null {
  if (err instanceof DeviceAuthError) return err.detail;
  const source = err as { detail?: unknown; message?: unknown } | null;
  for (const candidate of [source?.detail, source?.message]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
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
 * The extension, the web build and the desktop window are not "turned off" — they have no
 * bindable lock screen in reach, so the setting should be ABSENT rather than shown
 * disabled. Callers use this to decide whether to render anything.
 *
 * `isMobileApp()` reads the OS from the RUNTIME (`tauri-plugin-os` publishes it before the
 * first script runs), not from the URL and not from a user agent — see `lib/platform.ts`.
 * That distinction mattered more here than anywhere else when the native half was a third
 * party's: its web stub shipped in the same bundle as the extension and the web page, and
 * answered "available" unconditionally while implementing the secure store as a `Map`.
 * Anything reaching it would have written a sealed copy of the app password into
 * localStorage and called it protected. `nativeInvoke` now rejects off Tauri outright, so
 * there is no stub left to reach — but the gate stays, because a feature that renders and
 * then fails is worse than one that was never offered.
 */
export function deviceAuthPossible(): boolean {
  return isMobileApp();
}

/**
 * Classify a rejection from the native side.
 *
 * Reads the `failure` token, never the message: the message is the platform's own prose,
 * it differs between Android and iOS for the same condition, and it is localized on some
 * devices. The token is a contract all four halves of this feature spell identically.
 *
 * An unrecognised token is `'failed'` rather than a guess. That is the same fail-closed
 * direction as everything else here: the cases we understand least are not the ones to
 * invent a friendlier story about.
 */
export function deviceAuthFailure(err: unknown): DeviceAuthFailure {
  if (err instanceof DeviceAuthError) return err.failure;
  const raw = (err as { failure?: unknown } | null)?.failure;
  return typeof raw === 'string' && (FAILURES as readonly string[]).includes(raw)
    ? (raw as DeviceAuthFailure)
    : 'failed';
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

/** What the plugin's `auth_status` answers with. */
interface NativeStatus {
  available?: unknown;
  biometry?: unknown;
  reason?: unknown;
}

/**
 * What this device can do right now.
 *
 * The plugin answers only for Class 3 / biometry-backed authenticators, because only those
 * can gate a Keystore `CryptoObject` or a `.biometryCurrentSet` Keychain item. A weak
 * Class 2 face sensor and a PIN-only phone both come back `'noStrongBiometry'` — see the
 * header on why there is no unbound tier.
 *
 * Never throws: "what can this device do" is a question every build may ask, and
 * "nothing" is a valid answer to it. A rejected call is `UNAVAILABLE`, which is what the
 * Settings row already knows how to render.
 */
export async function deviceAuthAvailability(): Promise<DeviceAuthAvailability> {
  if (!deviceAuthPossible()) return UNAVAILABLE;
  try {
    const status = await nativeInvoke<NativeStatus>('auth_status');
    const kind = (KINDS as readonly string[]).includes(status.biometry as string)
      ? (status.biometry as DeviceAuthKind)
      : 'generic';
    if (status.available === true) return { available: true, kind, reason: null };
    // The reason travels as a plain token here rather than as a rejection, so it is
    // classified through the same path as an error would be.
    return { available: false, kind, reason: deviceAuthFailure({ failure: status.reason }) };
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
    // write is one whose key it cannot open, and "the feature is off" is the only safe
    // reading of that. The three values that have shipped and are refused here are named
    // in `DeviceAuthBinding` — `'anyBiometry'`, `'currentSet'` and `'passcode'` — as prose,
    // because a constant listing them would invite filtering AGAINST it, which is the
    // rejection list this comment exists to rule out.
    if (parsed.binding !== 'boundCurrentSet') return null;
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
 * Turn whatever the bridge rejected with into a `DeviceAuthError`.
 *
 * One place, because every caller needs both halves and reading them separately at four
 * call sites is how a `detail` gets dropped from the one path that shows it.
 */
function asDeviceAuthError(err: unknown): DeviceAuthError {
  return err instanceof DeviceAuthError ? err : new DeviceAuthError(deviceAuthFailure(err), deviceAuthDetail(err));
}

/**
 * Store the wrapping key so that only a live, cryptographically bound prompt opens it.
 *
 * The plugin's `auth_store` raises the OS prompt itself and binds the key to it, so there
 * is no separate check to run first — and deliberately no identity-verification call
 * anywhere in this module. A prompt that is not the same operation as the read is a prompt
 * the read does not need.
 *
 * DELETE-FIRST is the plugin's job, not this module's, and both native halves do it: a
 * second enrolment for the same wallet — which is what a password change is — must mint a
 * fresh key rather than rewriting the value under the old one. The cost is that a refusal
 * leaves the wallet with NO key, which is why `enableDeviceAuth` removes the envelope on
 * its way out. Fail closed in that direction on purpose: the alternative is an envelope
 * whose key belongs to a superseded password.
 */
async function storeBound(walletId: string, wrapKey: string, prompt: DeviceAuthPrompt): Promise<void> {
  await nativeInvoke<void>('auth_store', {
    payload: { key: secureKey(walletId), value: wrapKey, ...prompt },
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
 * If the device refuses, so do we. This used to fall through to an unbound key, which put
 * the wrapping key one prompt-free native call away from anything running in the process,
 * and on iOS put it in a restorable backup. A device that cannot bind the key keeps its
 * password instead.
 */
export async function enableDeviceAuth(
  walletId: string,
  password: string,
  prompt: DeviceAuthPrompt,
): Promise<DeviceAuthBinding> {
  if (!deviceAuthPossible()) throw new DeviceAuthError('unsupported');
  const { available, reason } = await deviceAuthAvailability();
  if (!available) throw new DeviceAuthError(reason ?? 'failed');

  const wrapKey = randomWrapKey();
  const sealed = await seal(password, wrapKey);

  try {
    await storeBound(walletId, wrapKey, prompt);
  } catch (err) {
    const error = asDeviceAuthError(err);
    // Drop any envelope this wallet still had. The plugin deletes the previous key before
    // it writes, so a failure here has already destroyed the key an EARLIER enrolment was
    // using — and leaving that wallet's old envelope behind means the app still reports
    // the feature as on while nothing can open it. Not hypothetical: the re-enrolment path
    // of a password change lands here every time the user dismisses the prompt. Removing it
    // makes the outcome "not enrolled", which Settings can fix.
    await storageRemove(envelopeKey(walletId)).catch(() => {});
    // Logged as well as thrown: an unclassified fault here frequently arrives with a
    // message that is the literal string "null", because AOSP's AndroidKeyStore throws
    // with no message at all. logcat still has the Keymaster's own error code; the app
    // never does. The failure and the detail only — never `password`, never `wrapKey`.
    console.warn('deviceAuth: the device refused to bind the key, refusing to enrol —', error.failure, error.detail);
    throw error;
  }

  const envelope: AuthEnvelope = { v: 1, binding: 'boundCurrentSet', box: sealed };
  await storageSet(envelopeKey(walletId), JSON.stringify(envelope));
  return 'boundCurrentSet';
}

/**
 * Prompt, then return the app password.
 *
 * The prompt is implicit: reading a bound entry IS the authenticated operation, so there
 * is no separate check that could be skipped, and no window in which the key is readable
 * without one.
 *
 * `'stale'` is handled rather than propagated raw: it means the key is gone — a changed
 * enrolment (which now destroys it by design), a restored backup, a reinstall — so the
 * envelope left behind is undecryptable forever. Clearing it here is what stops the unlock
 * screen offering a button that can only ever fail.
 */
export async function deviceAuthPassword(walletId: string, prompt: DeviceAuthPrompt): Promise<string> {
  if (!deviceAuthPossible()) throw new DeviceAuthError('unsupported');
  const envelope = await loadEnvelope(walletId);
  if (!envelope) throw new DeviceAuthError('stale');

  let wrapKey: string;
  try {
    const { value } = await nativeInvoke<{ value: string }>('auth_read', {
      payload: { key: secureKey(walletId), ...prompt },
    });
    wrapKey = value;
  } catch (err) {
    const error = asDeviceAuthError(err);
    if (error.failure === 'stale') await disableDeviceAuth(walletId);
    // NOT disabled on an unclassified failure, unlike enrolment: a read can fail
    // transiently (the key busy, the sheet interrupted), and wiping a working enrolment
    // over one bad read would cost the user their setup for something a retry fixes.
    throw error;
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
  if (!deviceAuthPossible()) return;
  try {
    await nativeInvoke<void>('auth_delete', { payload: { key: secureKey(walletId) } });
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
      // it on its own failure path, and an envelope with no key reads as 'stale' on the
      // next attempt — which turns itself off. Nothing here is worth throwing over.
    }
    return false;
  }
}
