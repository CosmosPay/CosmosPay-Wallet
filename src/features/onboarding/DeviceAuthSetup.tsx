import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import '@/styles/features/onboarding/device-auth-setup.css';

/**
 * Offered once, right after a wallet is created or imported: turn on unlocking with
 * the phone's own lock.
 *
 * A screen rather than a prompt on the success card, because the answer is a
 * security choice and the "no" has to be as easy to press as the "yes". Reached
 * only from `store.leaveSuccess()`, and only when the device can actually do it —
 * the extension never routes here.
 */
export function DeviceAuthSetup({ store }: { store: WalletStore }) {
  const t = store.t;
  const [busy, setBusy] = useState(false);
  const method = store.deviceAuthMethod;

  const accept = async () => {
    setBusy(true);
    try {
      await store.acceptDeviceAuthOffer();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr screen col device-auth-setup">
      <div className="f1 col center device-auth-setup-hero">
        <div className="glass center device-auth-setup-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3a7 7 0 0 0-7 7v2a9 9 0 0 1-.5 3" />
            <path d="M12 3a7 7 0 0 1 7 7v2c0 1.4-.2 2.7-.6 4" />
            <path d="M8.5 10a3.5 3.5 0 0 1 7 0v2c0 1.7-.3 3.4-.8 5" />
            <path d="M12 10v2.5c0 2.2-.4 4.4-1.2 6.4" />
          </svg>
        </div>
        <div className="device-auth-setup-title">{t('devAuth.offerTitle', { method })}</div>
        <div className="desc device-auth-setup-desc">{t('devAuth.offerBody', { method })}</div>
        {/* Said plainly here rather than buried in Settings: someone deciding this in
            the first minute has no reason to know the password still opens the wallet. */}
        <div className="device-auth-setup-note">{t('devAuth.offerNote')}</div>
      </div>

      <div className="col g12">
        <PrimaryButton disabled={busy} onClick={accept}>
          {busy ? <Spinner /> : t('devAuth.offerActivate', { method })}
        </PrimaryButton>
        <button type="button" disabled={busy} onClick={store.dismissDeviceAuthOffer} className="glass-soft device-auth-setup-later">
          {t('devAuth.offerLater')}
        </button>
      </div>
    </div>
  );
}
