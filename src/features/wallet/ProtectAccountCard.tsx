import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { Spinner } from '@/ui/Spinner';
import { useBusy } from '@/hooks/useBusy';
import { recoveryShortfall } from '@/lib/balances';
import { isAccessCode, normalizeAccessCode } from '@/lib/validate';
import { RECOVERY_OFFER_DISMISSED_PREFIX } from '@/constants/recovery';
import { PrimaryButton } from '@/ui/Buttons';
import { HomeCard } from '@/features/wallet/HomeCard';

/** Read and write the per-account "not now". Browser storage can be absent or refuse. */
function wasDismissed(address: string): boolean {
  try {
    return !!address && localStorage.getItem(RECOVERY_OFFER_DISMISSED_PREFIX + address) === '1';
  } catch {
    return false;
  }
}
function rememberDismissed(address: string): void {
  try {
    localStorage.setItem(RECOVERY_OFFER_DISMISSED_PREFIX + address, '1');
  } catch {
    /* the card simply comes back next time */
  }
}

/**
 * "Protect your account if you lose this device" — SEP-30 recovery, offered where people
 * actually are instead of four levels deep in Settings.
 *
 * It can only be turned on once the account EXISTS on the ledger (a signer is an entry on
 * an account, and an unfunded address has none), which is exactly when this card appears:
 * the first time Home shows a funded account with recovery off. Before this, recovery lived
 * only in Settings, almost nobody found it, and "forgot your password?" then listed no
 * account to recover — the one moment it was needed.
 *
 * One tap when the account can pay the two signers' reserve itself: the confirmation that
 * follows names the email, because that is the whole bargain (see `RecoverySection`).
 * When it cannot, the card says how much is missing and the operator sponsors the reserve
 * — that path needs the emailed code the store sends, asked for right here, not on another
 * screen — with a way to cover the shortfall and pay it yourself beside it.
 *
 * "Not now" is remembered per account, and Settings keeps the same controls for later.
 */
export function ProtectAccountCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const address = store.publicKey ?? '';
  const email = (store.meta?.email ?? '').trim();
  const [dismissed, setDismissed] = useState(() => wasDismissed(address));
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, run] = useBusy();

  // A switch to another wallet is another account, with its own answer.
  useEffect(() => {
    setDismissed(wasDismissed(address));
    setSent(false);
    setCode('');
  }, [address]);

  const { loadRecovery } = store;
  useEffect(() => {
    void loadRecovery();
  }, [loadRecovery, address]);

  const state = store.recovery;
  // Only a state read from the ledger decides this: a card for an account that is
  // already protected, or not yet funded, would offer something that cannot happen.
  if (dismissed || !email || !state || !state.exists || state.enabled) return null;

  const missing = recoveryShortfall(store.account);
  const affordable = missing === 0;
  const dismiss = () => {
    rememberDismissed(address);
    setDismissed(true);
  };

  return (
    <HomeCard title={t('recoveryCard.title')}>
      <p className="home-card-desc">{t('recoveryCard.desc', { email })}</p>

      {affordable ? (
        <PrimaryButton disabled={busy} onClick={() => void run(() => store.enableRecovery())}>
          {busy ? <Spinner /> : t('recoveryCard.cta')}
        </PrimaryButton>
      ) : !sent ? (
        <>
          <p className="home-card-desc">{t('recovery.needXlm', { amount: missing })}</p>
          <PrimaryButton disabled={busy} onClick={() => void run(async () => setSent(await store.startRecoveryCode()))}>
            {busy ? <Spinner /> : t('recoveryCard.cta')}
          </PrimaryButton>
          {/* The alternative to sponsorship: cover the shortfall and pay it yourself. */}
          {store.network.friendbot ? (
            <button type="button" disabled={busy} onClick={() => void run(() => store.topUpTestnet())} className="link-btn home-card-link">
              {t('recovery.topUpTestnet')}
            </button>
          ) : (
            <button type="button" onClick={() => store.go('receive')} className="link-btn home-card-link">
              {t('receive.title')}
            </button>
          )}
        </>
      ) : (
        <>
          <p className="home-card-desc">{t('signin.codeDesc', { email })}</p>
          {/* The same input the sign-in screen uses, down to the one-time-code hint —
              it is the same six digits from the same kind of email. */}
          <input
            value={code}
            onChange={(e) => setCode(normalizeAccessCode((e.target as HTMLInputElement).value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={t('cosmospay.codePlaceholder')}
            placeholder={t('cosmospay.codePlaceholder')}
            className="input home-card-code"
          />
          <PrimaryButton disabled={busy || !isAccessCode(code)} onClick={() => void run(() => store.enableRecovery({ code }))}>
            {busy ? <Spinner /> : t('recovery.turnOn')}
          </PrimaryButton>
        </>
      )}
      <button type="button" onClick={dismiss} className="link-btn home-card-link">
        {t('recoveryCard.later')}
      </button>
    </HomeCard>
  );
}
