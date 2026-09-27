import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { Spinner } from '@/ui/Spinner';
import { useBusy } from '@/hooks/useBusy';
import { spendableXlm } from '@/lib/balances';
import { isAccessCode, normalizeAccessCode } from '@/lib/validate';
import { RECOVERY_OFFER_DISMISSED_PREFIX, RECOVERY_RESERVE_XLM } from '@/constants/recovery';
import '@/styles/features/wallet/home.css';

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
 * When it cannot, the operator sponsors the reserve, and that path needs the emailed code
 * the store sends — asked for right here, not on another screen.
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

  const affordable = spendableXlm(store.account) >= RECOVERY_RESERVE_XLM;
  const dismiss = () => {
    rememberDismissed(address);
    setDismissed(true);
  };

  return (
    <div className="glass card home-protect">
      <div className="home-activate-title">{t('recoveryCard.title')}</div>
      <div className="home-activate-desc">{t('recoveryCard.desc', { email })}</div>

      {affordable ? (
        <button disabled={busy} onClick={() => run(() => store.enableRecovery())} className="home-activate-btn">
          {busy ? <Spinner /> : t('recoveryCard.cta')}
        </button>
      ) : !sent ? (
        <button
          disabled={busy}
          onClick={() => run(async () => setSent(await store.startRecoveryCode()))}
          className="home-activate-btn"
        >
          {busy ? <Spinner /> : t('recoveryCard.cta')}
        </button>
      ) : (
        <>
          <div className="home-activate-desc">{t('signin.codeDesc', { email })}</div>
          {/* The same input the sign-in screen uses, down to the one-time-code hint —
              it is the same six digits from the same kind of email. */}
          <input
            value={code}
            onChange={(e) => setCode(normalizeAccessCode((e.target as HTMLInputElement).value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t('cosmospay.codePlaceholder')}
            className="input home-protect-code"
          />
          <button
            disabled={busy || !isAccessCode(code)}
            onClick={() => run(() => store.enableRecovery({ code }))}
            className="home-activate-btn"
          >
            {busy ? <Spinner /> : t('recovery.turnOn')}
          </button>
        </>
      )}
      <button type="button" onClick={dismiss} className="home-protect-later">
        {t('recoveryCard.later')}
      </button>
    </div>
  );
}
