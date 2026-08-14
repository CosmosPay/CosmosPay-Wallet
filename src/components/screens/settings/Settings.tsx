import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { BackBar } from '@/components/parts';
import { LangFlag } from '@/components/flags';
import { SettingsSection } from '@/components/molecules/settings/SettingsSection';
import { SettingsRow } from '@/components/molecules/settings/SettingsRow';
import { ToggleRow } from '@/components/molecules/settings/ToggleRow';
import { ChangePassword } from '@/components/organisms/settings/ChangePassword';
import { DevModeSection } from '@/components/organisms/settings/DevModeSection';
import { useCopied } from '@/components/hooks';
import { shortAddr } from '@/lib/format';
import { cx } from '@/lib/cx';
import { LANGUAGES } from '@/lib/i18n';
import { THEME_OPTIONS } from '@/constants/settings';
import '@/styles/screens/settings/settings.css';

export function Settings({ store }: { store: WalletStore }) {
  const t = store.t;
  const pub = store.meta?.publicKey ?? '';
  const [copied, copy] = useCopied();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="scr screen pb-40">
      <BackBar title={t('settings.title')} onBack={() => store.back(store.session ? 'profile' : 'home')} />

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
              <LangFlag code={l.code} size={20} />{l.name}
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
        <SettingsRow label={t('settings.exportPhrase')} onClick={() => store.setScreen('export')} />
        <SettingsRow label={pwOpen ? t('settings.cancelChangePwd') : t('settings.changePwd')} onClick={() => setPwOpen((o) => !o)} last={!pwOpen} />
        {pwOpen && <ChangePassword store={store} onDone={() => setPwOpen(false)} />}
      </SettingsSection>

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
