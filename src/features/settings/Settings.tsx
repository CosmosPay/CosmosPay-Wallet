import { useEffect, useRef, useState } from 'react';
import { SECTION_SCROLL_DELAY_MS } from '@/constants/ui';
import type { WalletStore } from '@/state/store';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { GhostButton } from '@/ui/Buttons';
import { CheckIcon, CopyIcon, ThemeIcon } from '@/ui/Icons';
import { LangFlag } from '@/ui/LangFlag';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { SettingsRow } from '@/features/settings/SettingsRow';
import { ToggleRow } from '@/features/settings/ToggleRow';
import { ChangePassword } from '@/features/settings/ChangePassword';
import { PasskeySwitch } from '@/features/settings/PasskeySwitch';
import { ConnectedSites } from '@/features/settings/ConnectedSites';
import { RecoverySection } from '@/features/settings/RecoverySection';
import { BackupRecoverySection } from '@/features/settings/BackupRecoverySection';
import { DevModeSection } from '@/features/settings/DevModeSection';
import { useCopied } from '@/hooks/useCopied';
import { shortAddr } from '@/lib/format';
import { cx } from '@/lib/cx';
import { openExternal } from '@/lib/openExternal';
import { LANGUAGES } from '@/lib/i18n';
import { deviceAuthFailureKey } from '@/lib/deviceAuth';
import { AUTO_LOCK_OPTIONS, THEME_OPTIONS } from '@/constants/settings';
import '@/styles/features/settings/settings.css';

export function Settings({ store }: { store: WalletStore }) {
  const t = store.t;
  const pub = store.meta?.publicKey ?? '';
  const [copied, copy] = useCopied();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pkOpen, setPkOpen] = useState(false);

  // Only for the second-factor row below. Quiet: offline, the row is simply absent.
  const { signInMethods, loadSignInMethods } = store;
  useEffect(() => {
    if (!signInMethods) void loadSignInMethods({ quiet: true });
  }, [signInMethods, loadSignInMethods]);
  const mfaUrl = signInMethods?.mfaSettingsUrl ?? null;

  // Opened as "recover the account" (the Wallet tab): the recovery part, not the top of a long
  // screen. A step of this screen, so the browser's back leaves Settings as it came.
  const recoveryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (store.navStep !== 'recovery') return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(
      () => recoveryRef.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }),
      SECTION_SCROLL_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [store.navStep]);

  return (
    <div className="scr screen pb-40">
      <ScreenHeader title={t('settings.title')} onBack={store.goBack} />

      <SettingsSection title={t('settings.appearance')}>
        <div className="settings-choices">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={store.themePref === o.id}
              onClick={() => store.setThemePref(o.id)}
              className={cx('settings-theme-btn', store.themePref === o.id && 'is-on')}
            >
              <ThemeIcon kind={o.icon} />
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.language')}>
        <div className="settings-choices is-wrap">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              lang={l.code}
              aria-pressed={store.lang === l.code}
              onClick={() => store.setLang(l.code)}
              className={cx('settings-lang-btn', store.lang === l.code && 'is-on')}
            >
              <LangFlag code={l.code} />
              {l.name}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.myAddress')}>
        <button type="button" onClick={() => void copy(pub)} className="settings-item">
          <span className="settings-addr-text">{shortAddr(pub, 10, 10)}</span>
          <span className={cx('settings-addr-copy', copied && 'is-copied')}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? t('common.copied') : t('common.copy')}
          </span>
        </button>
      </SettingsSection>

      <SettingsSection title={t('settings.autoLock')}>
        <p className="settings-autolock-desc">{t('settings.autoLockDesc')}</p>
        <div className="settings-choices is-wrap" role="group" aria-label={t('settings.autoLock')}>
          {AUTO_LOCK_OPTIONS.map((o) => (
            <button
              key={o.ms}
              type="button"
              aria-pressed={store.autoLockMs === o.ms}
              onClick={() => store.setAutoLock(o.ms)}
              className={cx('settings-lang-btn', store.autoLockMs === o.ms && 'is-on')}
            >
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.security')}>
        <ToggleRow label={t('settings.confirmSigns')} desc={t('settings.confirmSignsDesc')} on={store.requireConfirm} onChange={() => store.toggleConfirm()} />
        {/* Absent, not disabled, off the phone build: an extension has no lock screen
            to reach, so a greyed-out row there would only invite a support question.
            On a phone that CAN do it but has nothing enrolled the row stays, carrying
            the reason — that one is fixable by the user. */}
        {store.deviceAuthPossible && (
          <ToggleRow
            label={t('devAuth.settingLabel')}
            desc={
              store.deviceAuthAvailable
                ? t('devAuth.settingDesc', { method: store.deviceAuthMethod })
                : t(deviceAuthFailureKey(store.deviceAuthReason ?? 'failed'))
            }
            on={store.deviceAuthEnabled}
            onChange={() => store.toggleDeviceAuth()}
          />
        )}
        <SettingsRow label={t('settings.exportPhrase')} onClick={() => store.setScreen('export')} />
        <SettingsRow label={t('settings.easyRecovery')} onClick={() => store.setScreen('easy-recovery-send')} />
        {/* The Cosmos Pay ACCOUNT's second factors, in Authentik — not the device passkey
            below, which opens this wallet. Optional: the sign-in only offers one, so this row
            is where anyone who said "not now" adds a key, an authenticator app or recovery
            codes later, or removes one. Absent without Authentik. */}
        {mfaUrl && (
          <>
            <div className="desc settings-subform-desc">{t('settings.mfaDesc')}</div>
            <SettingsRow
              label={t('settings.mfa')}
              onClick={() => {
                void openExternal(mfaUrl).then((ok) => {
                  if (!ok) store.flash(t('signin.openFailed'), 'err');
                });
              }}
            />
          </>
        )}
        {/* How this device opens. A passkey device has no password to change, so the row
            that changes one is not offered there — the passkey row is how it gets one back. */}
        {store.passkeyPossible && (
          <>
            {store.passkeyUnlock && <div className="desc settings-subform-desc">{t('passkey.statusOn')}</div>}
            <SettingsRow
              label={pkOpen ? t('common.cancel') : t(store.passkeyUnlock ? 'passkey.switchOff' : 'passkey.switchOn')}
              onClick={() => setPkOpen((o) => !o)}
              last={store.passkeyUnlock && !pkOpen}
            />
            {pkOpen && <PasskeySwitch store={store} onDone={() => setPkOpen(false)} />}
          </>
        )}
        {!store.passkeyUnlock && (
          <>
            <SettingsRow label={pwOpen ? t('settings.cancelChangePwd') : t('settings.changePwd')} onClick={() => setPwOpen((o) => !o)} last={!pwOpen} />
            {pwOpen && <ChangePassword store={store} onDone={() => setPwOpen(false)} />}
          </>
        )}
      </SettingsSection>

      <SettingsSection title={t('settings.privacy')}>
        <ToggleRow
          label={t('settings.diagnostics')}
          desc={t('settings.diagnosticsDesc')}
          on={store.diagnostics}
          onChange={store.setDiagnostics}
        />
      </SettingsSection>

      <div ref={recoveryRef} className="settings-anchor">
        <BackupRecoverySection store={store} />
        <RecoverySection store={store} />
      </div>

      <ConnectedSites store={store} />

      <DevModeSection store={store} />

      <SettingsSection title={t('settings.danger')}>
        {!confirmDelete ? (
          <button type="button" onClick={() => setConfirmDelete(true)} className="settings-danger-btn">
            {t('settings.deleteThis')}
          </button>
        ) : (
          <div className="settings-danger-box">
            <div className="settings-danger-text">
              {t('settings.deleteConfirm', { name: store.meta?.name ?? '' })}
            </div>
            <div className="settings-danger-actions">
              <GhostButton onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</GhostButton>
              <button type="button" onClick={() => void store.removeActiveWallet()} className="settings-danger-btn is-solid">
                {t('common.delete')}
              </button>
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
