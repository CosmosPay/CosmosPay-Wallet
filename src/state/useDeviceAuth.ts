/**
 * Unlocking with the phone's own lock — the state around `lib/deviceAuth.ts`.
 *
 * Its own slice for the reason `useSigningGate` is: it is small, but what it holds
 * is a claim about whether a second door into the wallet is open, and that claim
 * has to stay tied to ONE wallet. The enrolment is per wallet id, so a store field
 * that outlived a wallet switch would offer "unlock with your fingerprint" for the
 * wallet you just left.
 *
 * The slice owns no copy and raises no toast. Every action returns a discriminated
 * result and the caller decides what to say — which is what lets a dismissed prompt
 * (`'cancelled'`) pass silently while a real failure gets a line.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deviceAuthAvailability,
  deviceAuthEnabled,
  deviceAuthKindKey,
  deviceAuthPassword,
  deviceAuthDetail,
  deviceAuthPossible,
  disableDeviceAuth,
  enableDeviceAuth,
  type DeviceAuthAvailability,
  type DeviceAuthFailure,
  type DeviceAuthPrompt,
} from '@/lib/deviceAuth';
import type { TFn } from '@/lib/i18n';

/** Why the prompt is being raised — picks the wording the OS sheet shows. */
export type DeviceAuthPurpose = 'unlock' | 'sign' | 'enroll';

export type DeviceAuthResult =
  | { ok: true; password: string }
  /** `detail` is the platform's own sentence — shown only when `failure` is the
   *  unclassified bucket, where the code by itself explains nothing. */
  | { ok: false; failure: DeviceAuthFailure; detail: string | null };

const OFFLINE: DeviceAuthAvailability = { available: false, tier: null, kind: 'generic', reason: 'unsupported' };

/** OS-sheet copy per purpose. Built here because `lib/` carries no strings. */
function promptFor(purpose: DeviceAuthPurpose, t: TFn): DeviceAuthPrompt {
  const titleKey = purpose === 'sign' ? 'devAuth.signTitle' : purpose === 'enroll' ? 'devAuth.enrollTitle' : 'devAuth.unlockTitle';
  const reasonKey = purpose === 'sign' ? 'devAuth.signReason' : purpose === 'enroll' ? 'devAuth.enrollReason' : 'devAuth.unlockReason';
  return { title: t(titleKey), reason: t(reasonKey), cancel: t('common.cancel') };
}

export function useDeviceAuth(walletId: string | null, t: TFn) {
  const [availability, setAvailability] = useState<DeviceAuthAvailability>(OFFLINE);
  const [enabled, setEnabled] = useState(false);

  /**
   * Re-probe. Availability is not a constant even within one run: the user can
   * enrol a fingerprint, or remove every one of them, in the Settings app while
   * this app sits in the background.
   */
  const refreshDeviceAuth = useCallback(async () => {
    if (!deviceAuthPossible()) {
      setAvailability(OFFLINE);
      setEnabled(false);
      return;
    }
    const [avail, on] = await Promise.all([
      deviceAuthAvailability(),
      walletId ? deviceAuthEnabled(walletId) : Promise.resolve(false),
    ]);
    setAvailability(avail);
    setEnabled(on);
  }, [walletId]);

  // Re-runs on a wallet switch, which is the whole point of keying this per id.
  useEffect(() => {
    void refreshDeviceAuth();
  }, [refreshDeviceAuth]);

  /**
   * Ask the device, then hand back the app password.
   *
   * Guarded on `enabled` as well as availability: a wallet that never enrolled has
   * no envelope to open, and letting the call through would raise an OS prompt only
   * to fail `'stale'` right after it succeeded.
   */
  const deviceAuthUnlock = useCallback(
    async (purpose: DeviceAuthPurpose = 'unlock'): Promise<DeviceAuthResult> => {
      if (!walletId || !enabled) return { ok: false, failure: 'stale', detail: null };
      try {
        return { ok: true, password: await deviceAuthPassword(walletId, promptFor(purpose, t)) };
      } catch (err) {
        const failure = (err as { failure?: DeviceAuthFailure }).failure ?? 'failed';
        // 'stale' means lib/ already dropped the enrolment; mirror that here so the
        // button disappears instead of inviting a second doomed attempt.
        if (failure === 'stale') setEnabled(false);
        return { ok: false, failure, detail: deviceAuthDetail(err) };
      }
    },
    [walletId, enabled, t],
  );

  /**
   * Enrol. `password` must already be verified — the store passes the live
   * session's, which only ever comes from a successful decrypt.
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
        return { failure: (err as { failure?: DeviceAuthFailure }).failure ?? 'failed', detail: deviceAuthDetail(err) };
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
   * Memoised because the store spreads these into `useCallback` dependency lists.
   * A fresh object every render made `unlockWithDevice`, `confirmWithDevice`,
   * `toggleDeviceAuth`, `acceptDeviceAuthOffer` and `finishOnboarding` new on every
   * render too — no loop, but every consumer of those re-rendered for nothing.
   */
  return useMemo(
    () => ({
      /** Can this build offer it at all? False on the extension and the web build. */
      deviceAuthPossible: deviceAuthPossible(),
      /** Hardware/enrolment state of the DEVICE — not of this wallet. */
      deviceAuthAvailable: availability.available,
      deviceAuthKind: availability.kind,
      deviceAuthTier: availability.tier,
      deviceAuthReason: availability.reason,
      /** Human name of the method, for button and settings copy. */
      deviceAuthMethod: t(deviceAuthKindKey(availability.kind)),
      /** Has THIS wallet enrolled? */
      deviceAuthEnabled: enabled,
      /** Enrolled and the device can still answer — the only test a button should use. */
      deviceAuthReady: enabled && availability.available,
      deviceAuthUnlock,
      enableDeviceUnlock,
      disableDeviceUnlock,
      refreshDeviceAuth,
    }),
    [availability, enabled, t, deviceAuthUnlock, enableDeviceUnlock, disableDeviceUnlock, refreshDeviceAuth],
  );
}
