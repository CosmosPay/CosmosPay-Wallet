import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { LangFlag } from '@/ui/LangSelect';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { SettingsRow } from '@/features/settings/SettingsRow';
import { ToggleRow } from '@/features/settings/ToggleRow';
import { ChangePassword } from '@/features/settings/ChangePassword';
import { ConnectedSites } from '@/features/settings/ConnectedSites';
import { DevModeSection } from '@/features/settings/DevModeSection';
import { useCopied } from '@/hooks/useCopied';
import { shortAddr } from '@/lib/format';
import { cx } from '@/lib/cx';
import { LANGUAGES } from '@/lib/i18n';
import { deviceAuthFailureKey } from '@/lib/deviceAuth';
import { THEME_OPTIONS } from '@/constants/settings';
import '@/styles/features/settings/settings.css';

export function Settings({ store }: { store: WalletStore }) {
  const t = store.t;
  const pub = store.meta?.publicKey ?? '';
  const [copied, copy] = useCopied();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="scr screen pb-40">
      <BackBar title={t('settings.title')} onBack={store.goBack} />

      <SettingsSection title={t('settings.appearance')}>
        <div className="flexr g8">
          {THEME_OPTIONS.map((o) => (
            <button key={o.id} onClick={() => store.setTheme(o.id)} className={cx('settings-theme-btn', store.theme === o.id && 'is-on')}>
              <span>{o.icon}</span>{t(o.labelKey)}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.language')}>
        <div className="flexr g8 settings-lang-wrap">
          {LANGUAGES.map((l) => (
            <button key={l.code} onClick={() => store.setLang(l.code)} className={cx('row g8 settings-lang-btn', store.lang === l.code && 'is-on')}>
              <LangFlag code={l.code} />{l.name}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.myAddress')}>
        <div onClick={() => copy(pub)} className="tap glass row between settings-tile">
          <span className="settings-addr-text">{shortAddr(pub, 10, 10)}</span>
          <span className={cx('settings-addr-copy', copied && 'is-copied')}>{copied ? t('common.copied') : t('common.copy')}</span>
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
        <SettingsRow label={pwOpen ? t('settings.cancelChangePwd') : t('settings.changePwd')} onClick={() => setPwOpen((o) => !o)} last={!pwOpen} />
        {pwOpen && <ChangePassword store={store} onDone={() => setPwOpen(false)} />}
      </SettingsSection>

      <ConnectedSites store={store} />

      <DevModeSection store={store} />

      <SettingsSection title={t('settings.danger')}>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="settings-danger-btn">
            {t('settings.deleteThis')}
          </button>
        ) : (
          <div className="settings-danger-box">
            <div className="settings-danger-text">
              {t('settings.deleteConfirm', { name: store.meta?.name ?? '' })}
            </div>
            <div className="flexr g10">
              <button onClick={() => setConfirmDelete(false)} className="glass-soft settings-confirm-btn">{t('common.cancel')}</button>
              <button onClick={() => store.removeActiveWallet()} className="settings-confirm-btn settings-confirm-danger">{t('common.delete')}</button>
            </div>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
