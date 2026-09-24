import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { useBusy } from '@/hooks/useBusy';
import { spendableXlm } from '@/lib/balances';
import { isAccessCode, normalizeAccessCode } from '@/lib/validate';
import { RECOVERY_RESERVE_XLM } from '@/constants/recovery';
import { recoveryConfigured } from '@/lib/recovery';
import { shortAddr } from '@/lib/format';
import { cx } from '@/lib/cx';
import '@/styles/features/settings/recovery.css';

/**
 * Turning SEP-30 account recovery on and off.
 *
 * What it buys, said plainly on the screen because it is a real trade: two servers get a
 * signer on the account, each worth half of what a signature needs, and whoever can prove
 * this wallet's email to BOTH of them can have a new key put on the account. That is the
 * point — it is how a lost phone stops being a lost wallet — and it is also the cost, so
 * the confirmation names the email rather than asking for a generic yes.
 *
 * Absent entirely on a build with no recovery servers configured, and on a Pollar wallet,
 * whose key was never on this device for two servers to replace.
 *
 * The status comes from `store.recovery`, which is read from the LEDGER. A server saying
 * it protects an account it was never actually put on would otherwise show as protection
 * the user does not have.
 */
export function RecoverySection({ store }: { store: WalletStore }) {
  const t = store.t;
  const [busy, run] = useBusy();
  const [confirmOff, setConfirmOff] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const email = (store.meta?.email ?? '').trim().toLowerCase();
  // What the two servers were actually told, which is NOT `email`: the profile address is
  // editable at any time and SEP-30 will not report an identity back, so these two drift
  // apart in silence. Rendering `email` here would name an inbox that recovers nothing.
  const registered = (store.meta?.recoveryEmail ?? '').trim().toLowerCase();
  const configured = recoveryConfigured();

  const { loadRecovery } = store;
  useEffect(() => {
    if (configured) void loadRecovery();
  }, [configured, loadRecovery]);

  if (!configured || store.isPollarWallet) return null;

  const state = store.recovery;
  const on = state?.enabled ?? false;
  // Two ways the recorded address can fail to be the current one, and they read
  // differently to the person: one is a change they made, the other is a device that was
  // never told. Both end at the same button, which is the only way to make them agree.
  const drifted = on && registered !== '' && registered !== email;
  const unknown = on && registered === '';
  // Whether the account can pay the two signer entries' reserve itself. Below it the
  // operator's sponsored path is the only one that works, and it is what gets offered.
  const affordable = spendableXlm(store.account) >= RECOVERY_RESERVE_XLM;

  return (
    <SettingsSection title={t('recovery.title')}>
      <div className="desc recovery-desc">{t('recovery.what')}</div>

      {state && !state.exists ? (
        <div className="recovery-note">{t('recovery.error.notFunded')}</div>
      ) : on ? (
        <>
          <div className="row between recovery-status">
            <span className="recovery-status-on">{t('recovery.statusOn')}</span>
            <span className="recovery-email" title={t('recovery.emailRegistered')}>
              {registered || t('recovery.emailUnknown')}
            </span>
          </div>
          <div className="recovery-signers">
            {state?.signers.map((key) => (
              <div key={key} className="recovery-signer">
                {shortAddr(key)}
              </div>
            ))}
          </div>
          {/* Said before the turn-off button, because it is the more likely thing to be
              wrong and the less likely thing to be noticed: recovery is ON, so nothing
              looks broken until the day it is used from the wrong inbox. */}
          {(drifted || unknown) && (
            <div className="recovery-confirm">
              <div className="recovery-note recovery-note-warn">
                {drifted ? t('recovery.emailDrifted', { registered, email }) : t('recovery.emailUnknownNote', { email })}
              </div>
              <button
                disabled={busy || !email}
                onClick={() => run(() => store.updateRecoveryEmail())}
                className={cx('btn-primary recovery-btn', busy && 'is-busy')}
              >
                {t('recovery.emailUpdate')}
              </button>
            </div>
          )}

          {!confirmOff ? (
            <button onClick={() => setConfirmOff(true)} className="glass-soft recovery-btn">
              {t('recovery.turnOff')}
            </button>
          ) : (
            <div className="recovery-confirm">
              <div className="recovery-note">{t('recovery.offWarning')}</div>
              <div className="flexr g10">
                <button onClick={() => setConfirmOff(false)} className="glass-soft recovery-btn f1">
                  {t('common.cancel')}
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(async () => {
                    const ok = await store.disableRecovery();
                    if (ok) setConfirmOff(false);
                  })}
                  className={cx('recovery-btn recovery-btn-danger f1', busy && 'is-busy')}
                >
                  {t('recovery.turnOff')}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="recovery-status">
            <span className="recovery-status-off">{t('recovery.statusOff')}</span>
          </div>
          {/* The whole bargain, before the button rather than after it. */}
          <div className="recovery-note">{email ? t('recovery.bargain', { email }) : t('recovery.error.noEmail')}</div>

          {/* Two ways to pay for the signers' reserve, and which one is offered is decided
              by the balance rather than by the person: an account that cannot afford its
              own would otherwise meet `op_underfunded` at the end of the flow. */}
          {affordable ? (
            <>
              <button
                disabled={busy || !email}
                onClick={() => run(() => store.enableRecovery())}
                className={cx('btn-primary recovery-btn', busy && 'is-busy')}
              >
                {t('recovery.turnOn')}
              </button>
              <div className="desc recovery-desc">{t('recovery.reserveNote')}</div>
            </>
          ) : sent ? (
            <>
              <div className="recovery-note">{t('signin.codeDesc', { email })}</div>
              {/* The same input the sign-in screen uses, down to the one-time-code hint —
                  it is the same six digits from the same email. */}
              <input
                value={code}
                onChange={(e) => setCode(normalizeAccessCode((e.target as HTMLInputElement).value))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t('cosmospay.codePlaceholder')}
                className="input recovery-code-input"
              />
              <button
                disabled={busy || !isAccessCode(code)}
                onClick={() => run(() => store.enableRecovery({ code }))}
                className={cx('btn-primary recovery-btn', busy && 'is-busy')}
              >
                {t('recovery.turnOn')}
              </button>
            </>
          ) : (
            <>
              <div className="recovery-note">{t('recovery.sponsoredNote')}</div>
              <button
                disabled={busy || !email}
                onClick={() => run(async () => setSent(await store.startRecoveryCode()))}
                className={cx('btn-primary recovery-btn', busy && 'is-busy')}
              >
                {t('recovery.sponsoredCta')}
              </button>
            </>
          )}
        </>
      )}
    </SettingsSection>
  );
}
