import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Field } from '@/ui/Field';
import { KVRow } from '@/ui/KVRow';
import { SignInMethods } from '@/ui/SignInMethods';
import { Spinner } from '@/ui/Spinner';
import { amountText } from '@/lib/pollarMigration';
import { shortAddr } from '@/lib/format';
import { isAccessCode, normalizeAccessCode } from '@/lib/validate';
import '@/styles/features/wallet/migrate-pollar.css';

/**
 * Moving an old Pollar wallet's funds onto a key this device holds.
 *
 * Three steps, each shown only once the one before is done, because each needs it:
 *
 *  1. A NEW HOME for the funds — the same sign-in as onboarding, then a password: the one
 *     an existing backup was sealed under (restore), or this device's (a new wallet whose
 *     backup it seals). Recorded on the Pollar wallet before anything moves.
 *  2. THE MOVE — the plan, read from the chain: what moves, what stays behind as the old
 *     account's reserve, and why. Confirming it is what bounds every transaction the guard
 *     lets Pollar sign (`lib/pollarMigration.ts`).
 *  3. DONE — switch to the new wallet.
 *
 * If Pollar refuses the session (it expired while the app sat unused) the move stops and
 * the screen offers the one thing that fixes it: logging in to Pollar again.
 */
export function MigratePollar({ store }: { store: WalletStore }) {
  const t = store.t;
  const target = store.migrationTarget;
  const pending = store.signInPending?.purpose === 'migrate' ? store.signInPending : null;
  const plan = store.migrationPlan;
  const [pwd, setPwd] = useState('');
  const [code, setCode] = useState('');

  // Once per mount: a reconnect or a sign-in a closed popup left open.
  useEffect(() => {
    void store.resumePollarReconnect();
    if (!target) {
      void store.loadSignInMethods();
      void store.resumeSignIn('migrate');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The plan follows the target: read it as soon as there is somewhere to move to.
  useEffect(() => {
    if (target) void store.loadMigrationPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  if (!store.isPollarWallet) {
    return (
      <div className="scr screen col">
        <BackBar title={t('migrate.title')} onBack={store.goBack} />
        <div className="desc migrate-lead">{t('migrate.notPollar')}</div>
      </div>
    );
  }

  /* ------------------------------ 1: a new home ------------------------------ */
  if (!target) {
    const restoring = !!pending?.backupAddress && !pending.replace;
    return (
      <div className="scr screen col">
        <BackBar
          title={t('migrate.title')}
          onBack={() => {
            store.cancelSignIn();
            store.goBack();
          }}
        />
        <div className="desc migrate-lead">{t('migrate.intro')}</div>
        {!pending ? (
          <SignInMethods
            t={t}
            offer={store.signInMethods}
            phase={store.signInPhase}
            code={store.signInCode}
            url={store.signInUrl}
            onProvider={(p) => void store.signInWith(p, 'migrate')}
            onEmail={(email) => void store.signInWithEmail(email)}
            onCode={(c) => void store.submitSignInCode(c, 'migrate')}
            onCancel={store.cancelSignIn}
          />
        ) : (
          <div className="col g8 migrate-step">
            <div className="desc">
              {restoring
                ? t('migrate.restoreDesc', { email: pending.email, address: shortAddr(pending.backupAddress ?? '') })
                : t('migrate.protectDesc', { email: pending.email })}
            </div>
            <Field
              password
              label={t(restoring ? 'signin.backupPwdLabel' : 'pwd.label')}
              value={pwd}
              onChange={setPwd}
            />
            <PrimaryButton disabled={!pwd || store.busy} onClick={() => void store.completeSignIn(pwd)}>
              {store.busy ? <Spinner /> : t(restoring ? 'signin.restoreCta' : 'signin.createCta')}
            </PrimaryButton>
          </div>
        )}
      </div>
    );
  }

  /* --------------------------------- 3: done --------------------------------- */
  if (store.migrationPhase === 'done') {
    return (
      <div className="scr screen col">
        <BackBar title={t('migrate.title')} onBack={store.goBack} />
        <div className="glass card migrate-card">
          <div className="migrate-card-title">{t('migrate.doneTitle')}</div>
          <div className="desc">{t('migrate.doneDesc', { name: target.name })}</div>
          {plan && plan.leftBehind > 0n && (
            <div className="desc migrate-note">{t('migrate.leftBehind', { amount: amountText(plan.leftBehind) })}</div>
          )}
        </div>
        <div className="spacer" />
        <div className="kb-dock">
          <PrimaryButton onClick={() => void store.openMigratedWallet()}>{t('migrate.openNew')}</PrimaryButton>
        </div>
      </div>
    );
  }

  /* --------------------------------- 2: the move ------------------------------ */
  const running = store.migrationPhase === 'running';
  const reconnect = store.pollarReconnectPhase;
  const needsReconnect = store.migrationNeedsReconnect || reconnect !== 'idle';
  return (
    <div className="scr screen col">
      <BackBar title={t('migrate.title')} onBack={store.goBack} />
      <div className="desc migrate-lead">{t('migrate.planIntro', { name: target.name })}</div>

      {!plan || store.migrationPhase === 'loading' ? (
        <div className="row center migrate-loading">
          <Spinner tone="text" />
        </div>
      ) : (
        <div className="glass card migrate-card">
          <KVRow label={t('migrate.to')} value={shortAddr(target.publicKey)} mono />
          {plan.assets.map((a) => (
            <KVRow key={`${a.code}:${a.issuer}`} label={a.code} value={amountText(a.amount)} />
          ))}
          {plan.fund + plan.xlm > 0n && <KVRow label="XLM" value={amountText(plan.fund + plan.xlm)} />}
          <KVRow label={t('migrate.stays')} value={`${amountText(plan.leftBehind)} XLM`} />
          <div className="desc migrate-note">{t('migrate.staysWhy')}</div>
          {plan.lockedInOffers && <div className="desc migrate-note">{t('migrate.offers')}</div>}
          {plan.poolShares && <div className="desc migrate-note">{t('migrate.poolShares')}</div>}
          {plan.problem?.kind === 'insufficient_xlm' && (
            <div className="err-line">
              {t('migrate.insufficientDetail', { needed: amountText(plan.problem.needed), available: amountText(plan.problem.available) })}
            </div>
          )}
          {plan.problem?.kind === 'nothing_to_move' && <div className="desc migrate-note">{t('migrate.nothing')}</div>}
        </div>
      )}

      {running && (
        <div className="row g8 migrate-progress">
          <Spinner tone="text" />
          <span className="f1 min0">
            {t('migrate.progress', { done: store.migrationProgress.done, total: store.migrationProgress.total })}
          </span>
        </div>
      )}

      {/* Pollar refused the session: only a new Pollar login fixes that. */}
      {needsReconnect && (
        <div className="glass-soft col g8 migrate-reconnect">
          <div className="desc">{t('migrate.reconnectDesc')}</div>
          {reconnect === 'code' ? (
            <>
              <input
                value={code}
                onChange={(e) => setCode(normalizeAccessCode((e.target as HTMLInputElement).value))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t('cosmospay.codePlaceholder')}
                className="input migrate-code"
              />
              <button className="btn-primary" disabled={!isAccessCode(code)} onClick={() => void store.submitReconnectCode(code)}>
                {t('signin.codeCta')}
              </button>
            </>
          ) : reconnect === 'idle' ? (
            <button className="btn-ghost" onClick={() => void store.reconnectPollar()}>
              {t('migrate.reconnectCta')}
            </button>
          ) : (
            <div className="row g8">
              <Spinner tone="text" />
              <span className="f1 min0">{t('signin.waiting')}</span>
              <button className="migrate-link" onClick={store.cancelPollarReconnect}>
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton
          disabled={!plan || !!plan.problem || running || store.migrationPhase === 'loading'}
          onClick={() => void store.runMigration()}
        >
          {running ? <Spinner /> : t('migrate.cta')}
        </PrimaryButton>
      </div>
    </div>
  );
}
