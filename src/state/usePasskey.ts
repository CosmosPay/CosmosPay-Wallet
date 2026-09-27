/**
 * Whether this device opens with a passkey — the state around `lib/passkeyUnlock.ts`.
 *
 * Device-wide, unlike `useDeviceAuth`, which is per wallet: what the passkey door holds is
 * the device's app password, and there is one of those for every wallet here. So the flag
 * does not change on a wallet switch, and nothing here needs a generation counter for one.
 *
 * It holds flags and a refresh, nothing that produces or consumes a secret. Every action
 * that raises a passkey sheet lives in the store, because each one composes the sheet with
 * a vault operation (unlock, a password check, a password change) that only the store owns.
 *
 * `passkeyPossible` LEARNS. It starts from what the build can do (`lib/passkey.ts`), drops
 * to false when the browser says outright that it has no PRF, and drops for the rest of
 * the session the first time a ceremony comes back `unsupported` or `noPrf` — an offer the
 * person has just watched fail is not one to keep making.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { passkeyPossible, passkeyPrfReported } from '@/lib/passkey';
import { passkeyUnlockCredential } from '@/lib/passkeyUnlock';

export interface PasskeyPublic {
  /** Worth offering a passkey here? False where the platform said no, and once it has failed. */
  passkeyPossible: boolean;
  /** Does THIS device open with a passkey (it has no password anyone typed)? */
  passkeyUnlock: boolean;
  refreshPasskey: () => Promise<void>;
  /** A ceremony said this browser cannot do it: stop offering it this session. */
  markPasskeyUnavailable: () => void;
}

export function usePasskey(): PasskeyPublic {
  const [enrolled, setEnrolled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const buildCan = passkeyPossible();

  const refreshPasskey = useCallback(async () => {
    // Read even after an offer failed: a device that already opens with a passkey keeps
    // its button, because that is its only way in.
    setEnrolled(buildCan && (await passkeyUnlockCredential()) !== null);
  }, [buildCan]);

  useEffect(() => {
    void refreshPasskey();
  }, [refreshPasskey]);

  useEffect(() => {
    if (!buildCan) return;
    void passkeyPrfReported().then((prf) => {
      if (prf === false) setUnavailable(true);
    });
  }, [buildCan]);

  const markPasskeyUnavailable = useCallback(() => setUnavailable(true), []);

  return useMemo(
    () => ({
      passkeyPossible: buildCan && !unavailable,
      passkeyUnlock: enrolled,
      refreshPasskey,
      markPasskeyUnavailable,
    }),
    [buildCan, unavailable, enrolled, refreshPasskey, markPasskeyUnavailable],
  );
}
