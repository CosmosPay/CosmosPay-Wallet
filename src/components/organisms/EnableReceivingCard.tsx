import { useState } from 'react';
import type { ReactNode } from 'react';
import type { WalletStore } from '@/components/store';
import { Spinner } from '@/components/atoms/Spinner';
import { useBusy } from '@/components/hooks';
import '@/styles/components/enable-receiving-card.css';

/** The card shell every state below wears: title, description, optional body,
 *  a primary action that spins while busy and an optional secondary action. */
function Card({
  title,
  desc,
  note,
  children,
  cta,
  onCta,
  ctaDisabled,
  secondary,
  onSecondary,
  busy,
}: {
  title: string;
  desc: string;
  note?: string;
  children?: ReactNode;
  cta: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  secondary?: string;
  onSecondary?: () => void;
  busy: boolean;
}) {
  return (
    <div className="glass card enable-receiving-card">
      <div className="enable-receiving-title">{title}</div>
      <div className="enable-receiving-desc">{desc}</div>
      {note && <div className="enable-receiving-mismatch">{note}</div>}
      {children}
      <button onClick={onCta} disabled={busy || ctaDisabled} className="enable-receiving-cta">
        {busy ? <Spinner /> : cta}
      </button>
      {secondary && (
        <button onClick={onSecondary} disabled={busy} className="enable-receiving-cancel">
          {secondary}
        </button>
      )}
    </div>
  );
}

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
  // LOCAL busy: only this card's own actions spin its buttons — an unrelated global
  // action (e.g. Home's "activate account" / Friendbot funding) must not.
  const [busy, run] = useBusy();

  // Link flow — enter the emailed access code.
  if (link?.stage === 'sent') {
    return (
      <Card
        busy={busy}
        title={t('cosmospay.codeTitle')}
        desc={t('cosmospay.codeDesc')}
        cta={t('cosmospay.linkVerifyCta')}
        onCta={() => run(() => store.submitLinkCode(code))}
        ctaDisabled={code.length !== 6}
        secondary={t('common.cancel')}
        onSecondary={() => {
          setCode('');
          store.cancelLink();
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={t('cosmospay.codePlaceholder')}
          className="enable-receiving-code"
        />
      </Card>
    );
  }

  // Link flow — offer to link the existing account.
  if (link?.stage === 'offer') {
    return (
      <Card
        busy={busy}
        title={t('cosmospay.existsLinkTitle')}
        desc={t('cosmospay.existsLinkDesc')}
        cta={t('cosmospay.linkCta')}
        onCta={() => run(() => store.linkReceiving())}
        secondary={t('common.cancel')}
        onSecondary={() => store.cancelLink()}
      />
    );
  }

  // Default — enable (create) / confirm-email.
  // If the pending registration went to a DIFFERENT email than the wallet's current
  // one (e.g. the user fixed a typo in Profile), surface it and offer a resend.
  const pendingEmail = store.cosmosPayPending?.email;
  const emailMismatch = pending && !!pendingEmail && !!store.meta?.email && pendingEmail !== store.meta.email;
  return (
    <Card
      busy={busy}
      title={pending ? t('cosmospay.pendingTitle') : t('cosmospay.cardTitle')}
      desc={pending ? t('cosmospay.pendingDesc') : t('cosmospay.cardDesc')}
      note={emailMismatch ? t('cosmospay.emailMismatch', { old: pendingEmail!, new: store.meta!.email }) : undefined}
      cta={pending ? t('cosmospay.confirmCta') : t('cosmospay.cta')}
      onCta={() => run(() => (pending ? store.claimReceiving() : store.enableReceiving()))}
      secondary={pending ? t('cosmospay.resend') : undefined}
      onSecondary={() => run(() => store.resendReceiving())}
    />
  );
}
