import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { Spinner } from '@/components/atoms/Spinner';
import '@/styles/components/enable-receiving-card.css';

/**
 * CosmosPay account card — shared by the Home screen and the Swap screen so both
 * route the user through the same provisioning/linking flow. States:
 *   - enable (initial) / confirm-email (register flow);
 *   - link offer + access-code entry (when the email already has an account).
 */
export function EnableReceivingCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const pending = !!store.cosmosPayPending;
  const link = store.cosmosLink;
  const [code, setCode] = useState('');

  // Link flow — enter the emailed access code.
  if (link?.stage === 'sent') {
    const ready = code.length === 6 && !store.busy;
    return (
      <div className="glass card enable-receiving-card">
        <div className="enable-receiving-title">{t('cosmospay.codeTitle')}</div>
        <div className="enable-receiving-desc">{t('cosmospay.codeDesc')}</div>
        <input
          value={code}
          onChange={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={t('cosmospay.codePlaceholder')}
          className="enable-receiving-code"
        />
        <button
          onClick={() => store.submitLinkCode(code)}
          disabled={!ready}
          className="enable-receiving-cta"
          style={{ opacity: ready ? 1 : 0.5 }}
        >
          {store.busy ? <Spinner /> : t('cosmospay.linkVerifyCta')}
        </button>
        <button onClick={() => { setCode(''); store.cancelLink(); }} disabled={store.busy} className="enable-receiving-cancel">
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  // Link flow — offer to link the existing account.
  if (link?.stage === 'offer') {
    return (
      <div className="glass card enable-receiving-card">
        <div className="enable-receiving-title">{t('cosmospay.existsLinkTitle')}</div>
        <div className="enable-receiving-desc">{t('cosmospay.existsLinkDesc')}</div>
        <button onClick={() => store.linkReceiving()} disabled={store.busy} className="enable-receiving-cta">
          {store.busy ? <Spinner /> : t('cosmospay.linkCta')}
        </button>
        <button onClick={() => store.cancelLink()} disabled={store.busy} className="enable-receiving-cancel">
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  // Default — enable (create) / confirm-email.
  // If the pending registration went to a DIFFERENT email than the wallet's current
  // one (e.g. the user fixed a typo in Profile), surface it and offer a resend.
  const pendingEmail = store.cosmosPayPending?.email;
  const emailMismatch = pending && !!pendingEmail && !!store.meta?.email && pendingEmail !== store.meta.email;
  return (
    <div className="glass card enable-receiving-card">
      <div className="enable-receiving-title">{pending ? t('cosmospay.pendingTitle') : t('cosmospay.cardTitle')}</div>
      <div className="enable-receiving-desc">{pending ? t('cosmospay.pendingDesc') : t('cosmospay.cardDesc')}</div>
      {emailMismatch && (
        <div className="enable-receiving-mismatch">
          {t('cosmospay.emailMismatch', { old: pendingEmail!, new: store.meta!.email })}
        </div>
      )}
      <button
        onClick={() => (pending ? store.claimReceiving() : store.enableReceiving())}
        disabled={store.busy}
        className="enable-receiving-cta"
      >
        {store.busy ? <Spinner /> : pending ? t('cosmospay.confirmCta') : t('cosmospay.cta')}
      </button>
      {pending && (
        <button onClick={() => store.resendReceiving()} disabled={store.busy} className="enable-receiving-cancel">
          {t('cosmospay.resend')}
        </button>
      )}
    </div>
  );
}
