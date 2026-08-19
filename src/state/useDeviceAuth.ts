/**
 * Unlocking with the phone's own biometrics — the state around `lib/deviceAuth.ts`.
 *
 * Its own slice for the reason `useSigningGate` is: it is small, but what it holds is a
 * claim about whether a second door into the wallet is open, and that claim has to stay
 * tied to ONE wallet. The enrolment is per wallet id, so a store field that outlived a
 * wallet switch would offer "unlock with your fingerprint" for the wallet you just left.
 *
 * The slice owns no copy and raises no toast. Every action returns a discriminated result
 * and the caller decides what to say — which is what lets a dismissed prompt
 * (`'cancelled'`) pass silently while a real failure gets a line.
 *
 * TWO RETURN OBJECTS, ON PURPOSE. `deviceAuthPrivileged` holds everything that can
 * produce or consume the app password; `deviceAuthPublic` holds flags and a refresh. The
 * store spreads only the public half into the object 56 components hold. They are two
 * objects rather than one flat one because the previous shape was a hand-maintained
 * allowlist in the facade: correct, but one `...deviceAuth` away from handing
 * `deviceAuthUnlock` — which RETURNS THE APP PASSWORD — to every screen. There is no flat
 * object to spread now, so that mistake does not typecheck into existence.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deviceAuthAvailability,
  deviceAuthEnabled,
  deviceAuthFailure,
  deviceAuthKindKey,
  deviceAuthPassword,
  deviceAuthDetail,
  deviceAuthPossible,
  disableDeviceAuth,
  enableDeviceAuth,
  reenrolDeviceAuth,
  type DeviceAuthAvailability,
  type DeviceAuthFailure,
  type DeviceAuthKind,
  type DeviceAuthPrompt,
} from '@/lib/deviceAuth';
import type { TFn } from '@/lib/i18n';

/** Why the prompt is being raised — picks the wording the OS sheet shows. */
export type DeviceAuthPurpose = 'unlock' | 'sign' | 'enroll' | 'rewrap';

export type DeviceAuthResult =
  | { ok: true; password: string }
  /** `detail` is the platform's own sentence — shown only when `failure` is the
   *  unclassified bucket, where the code by itself explains nothing. */
  | { ok: false; failure: DeviceAuthFailure; detail: string | null };

/** The half of the slice that may cross into the store's public object. */
export interface DeviceAuthPublic {
  /** Can this build offer it at all? False on the extension and the web build. */
  deviceAuthPossible: boolean;
  /** Hardware/enrolment state of the DEVICE — not of this wallet. */
  deviceAuthAvailable: boolean;
  deviceAuthKind: DeviceAuthKind;
  deviceAuthReason: DeviceAuthFailure | null;
  /** Human name of the method, for button and settings copy. */
  deviceAuthMethod: string;
  /** Has THIS wallet enrolled? */
  deviceAuthEnabled: boolean;
  /** Enrolled and the device can still answer — the only test a button should use. */
  deviceAuthReady: boolean;
  refreshDeviceAuth: () => Promise<void>;
}

const OFFLINE: DeviceAuthAvailability = { available: false, kind: 'generic', reason: 'unsupported' };

/** OS-sheet copy per purpose. Built here because `lib/` carries no strings. */
function promptFor(purpose: DeviceAuthPurpose, t: TFn): DeviceAuthPrompt {
  const TITLES: Record<DeviceAuthPurpose, string> = {
    unlock: 'devAuth.unlockTitle',
    sign: 'devAuth.signTitle',
    enroll: 'devAuth.enrollTitle',
    rewrap: 'devAuth.rewrapTitle',
  };
  // Enrolling and re-wrapping ask for the same thing — permission to store the password
  // on this phone — so they share a reason and differ only in title.
  const REASONS: Record<DeviceAuthPurpose, string> = {
    unlock: 'devAuth.unlockReason',
    sign: 'devAuth.signReason',
    enroll: 'devAuth.enrollReason',
    rewrap: 'devAuth.enrollReason',
  };
  return { title: t(TITLES[purpose]), reason: t(REASONS[purpose]), cancel: t('common.cancel') };
}

export function useDeviceAuth(walletId: string | null, t: TFn) {
  const [availability, setAvailability] = useState<DeviceAuthAvailability>(OFFLINE);
  const [enabled, setEnabled] = useState(false);

  /**
   * Generation counter, for the same reason `lib/query.ts` has one: the probe is async
   * and its scope can change while it is in flight. Without it, switching wallets on the
   * unlock screen mid-probe wrote wallet A's `enabled` into state for wallet B — which
   * is the "offer a fingerprint for the wallet you just left" bug this slice exists to
   * prevent, arriving through the back door.
   */
  const genRef = useRef(0);

  /**
   * Re-probe. Availability is not a constant even within one run: the user can enrol a
   * fingerprint, or remove every one of them, in the Settings app while this app sits in
   * the background.
   */
  const refreshDeviceAuth = useCallback(async () => {
    const gen = ++genRef.current;
    if (!deviceAuthPossible()) {
      setAvailability(OFFLINE);
      setEnabled(false);
      return;
    }
    const [avail, on] = await Promise.all([
      deviceAuthAvailability(),
      walletId ? deviceAuthEnabled(walletId) : Promise.resolve(false),
    ]);
    if (gen !== genRef.current) return; // a newer probe (or a wallet switch) superseded this one
    setAvailability(avail);
    setEnabled(on);
  }, [walletId]);

  /**
   * Assume NOT enrolled the moment the wallet changes, then let the probe say otherwise.
   *
   * The generation counter stops a stale probe writing wallet A's answer onto wallet B, but
   * it cannot un-render the frames in between: `refreshDeviceAuth` runs in an effect, after
   * the render that already carries the new id and the OLD flag. Picking a different wallet
   * on the lock screen therefore painted "unlock with your fingerprint" for a wallet that
   * never enrolled — verbatim the symptom this slice exists to prevent, narrowed to a few
   * frames rather than removed. Tapping it only ever failed 'stale', so nothing crossed
   * wallets; the button was still a lie.
   */
  useEffect(() => {
    setEnabled(false);
  }, [walletId]);

  // Re-runs on a wallet switch, which is the whole point of keying this per id.
  useEffect(() => {
    void refreshDeviceAuth();
  }, [refreshDeviceAuth]);

  /**
   * Ask the device, then hand back the app password.
   *
   * Guarded on `enabled` as well as availability: a wallet that never enrolled has no
   * envelope to open, and letting the call through would raise an OS prompt only to fail
   * `'stale'` right after it succeeded.
   */
  const deviceAuthUnlock = useCallback(
    async (purpose: DeviceAuthPurpose = 'unlock'): Promise<DeviceAuthResult> => {
      if (!walletId || !enabled) return { ok: false, failure: 'stale', detail: null };
      try {
        return { ok: true, password: await deviceAuthPassword(walletId, promptFor(purpose, t)) };
      } catch (err) {
        // `deviceAuthFailure`, not a property read: the Capacitor bridge can reject with
        // `null`, and `(null as {failure?}).failure` throws a TypeError from inside this
        // catch — turning a classified failure into an unhandled rejection on the one path
        // whose whole job is to classify failures.
        const failure = deviceAuthFailure(err);
        // 'stale' means lib/ already dropped the enrolment; mirror that here so the
        // button disappears instead of inviting a second doomed attempt. The generation
        // is bumped too: a probe still in flight would otherwise land afterwards and set
        // `enabled` back to true for an enrolment that no longer exists.
        if (failure === 'stale') {
          genRef.current += 1;
          setEnabled(false);
        }
        return { ok: false, failure, detail: deviceAuthDetail(err) };
      }
    },
    [walletId, enabled, t],
  );

  /**
   * Enrol. `password` must already be verified — the store passes the live session's,
   * which only ever comes from a successful decrypt.
   */
  const enableDeviceUnlock = useCallback(
    async (password: string): Promise<{ failure: DeviceAuthFailure; detail: string | null } | null> => {
      if (!walletId) return { failure: 'unsupported', detail: null };
      try {
        await enableDeviceAuth(walletId, password, promptFor('enroll', t));
        setEnabled(true);
        await refreshDeviceAuth();
        return null;
      } catch (err) {
        setEnabled(false);
        return { failure: deviceAuthFailure(err), detail: deviceAuthDetail(err) };
      }
    },
    [walletId, t, refreshDeviceAuth],
  );

  const disableDeviceUnlock = useCallback(async () => {
    if (!walletId) return;
    await disableDeviceAuth(walletId);
    setEnabled(false);
  }, [walletId]);

  /**
   * Re-enrol one wallet under a new password, for `changePassword` to inject.
   *
   * Takes an explicit `walletId` rather than closing over this slice's: a password change
   * touches EVERY wallet, not only the active one. It lives here so the prompt copy stays
   * in `state/` — `lib/vault.ts` still imports the prompt-free `disableDeviceAuth`, but
   * nothing that raises a sheet or needs a translated string.
   */
  const reenrolForPasswordChange = useCallback(
    (id: string, newPassword: string) => reenrolDeviceAuth(id, newPassword, promptFor('rewrap', t)),
    [t],
  );

  /**
   * Memoised because the store spreads these into `useCallback` dependency lists. A fresh
   * object every render made `unlockWithDevice`, `confirmWithDevice`, `toggleDeviceAuth`,
   * `acceptDeviceAuthOffer` and `finishOnboarding` new on every render too — no loop, but
   * every consumer of those re-rendered for nothing.
   */
  const deviceAuthPublic = useMemo<DeviceAuthPublic>(
    () => ({
      deviceAuthPossible: deviceAuthPossible(),
      deviceAuthAvailable: availability.available,
      deviceAuthKind: availability.kind,
      deviceAuthReason: availability.reason,
      deviceAuthMethod: t(deviceAuthKindKey(availability.kind)),
      deviceAuthEnabled: enabled,
      deviceAuthReady: enabled && availability.available,
      refreshDeviceAuth,
    }),
    [availability, enabled, t, refreshDeviceAuth],
  );

  const deviceAuthPrivileged = useMemo(
    () => ({ deviceAuthUnlock, enableDeviceUnlock, disableDeviceUnlock, reenrolForPasswordChange }),
    [deviceAuthUnlock, enableDeviceUnlock, disableDeviceUnlock, reenrolForPasswordChange],
  );

  return { deviceAuthPublic, deviceAuthPrivileged };
}
