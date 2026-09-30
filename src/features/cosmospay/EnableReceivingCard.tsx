import { useState } from 'react';
import type { ReactNode } from 'react';
import type { WalletStore } from '@/state/store';
import { Spinner } from '@/ui/Spinner';
import { useBusy } from '@/hooks/useBusy';
import '@/styles/features/cosmospay/enable-receiving-card.css';

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
 * route the user through the same flow. Two states:
 *   - connect (initial): emails a sign-in code to the wallet's email;
 *   - code entry: the code, then the password that signs with this wallet's key.
 * It creates the account or joins the one the email already has — the server decides.
 */
export function EnableReceivingCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const link = store.cosmosLink;
  const [code, setCode] = useState('');
  // LOCAL busy: only this card's own actions spin its buttons — an unrelated global
  // action (e.g. Home's "activate account" / Friendbot funding) must not.
  const [busy, run] = useBusy();

  if (link) {
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

  return (
    <Card
      busy={busy}
      title={t('cosmospay.cardTitle')}
      desc={t('cosmospay.cardDesc')}
      cta={t('cosmospay.cta')}
      onCta={() => run(() => store.enableReceiving())}
    />
  );
}
