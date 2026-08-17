import { useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/parts';
import { LangFlag } from '@/ui/flags';
import { SettingsSection } from '@/features/settings/components/SettingsSection';
import { SettingsRow } from '@/features/settings/components/SettingsRow';
import { ToggleRow } from '@/features/settings/components/ToggleRow';
import { ChangePassword } from '@/features/settings/components/ChangePassword';
import { DevModeSection } from '@/features/settings/components/DevModeSection';
import { copyText } from '@/lib/clipboard';
import { shortAddr } from '@/lib/format';
import { LANGUAGES } from '@/lib/i18n';
import '@/styles/features/settings/settings.css';

export function Settings({ store }: { store: WalletStore }) {
  const t = store.t;
  const pub = store.meta?.publicKey ?? '';
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const copy = async () => {
    await copyText(pub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="scr screen pb-40">
      <BackBar title={t('settings.title')} onBack={() => store.back(store.session ? 'profile' : 'home')} />

      <SettingsSection title={t('settings.appearance')}>
        <div className="flexr g8">
          {([['dark', t('settings.dark'), '🌙'], ['light', t('settings.light'), '☀️']] as const).map(([th, label, icon]) => (
            <button key={th} onClick={() => store.setTheme(th)} className={store.theme === th ? 'settings-theme-btn is-on' : 'settings-theme-btn'}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.language')}>
        <div className="flexr g8 settings-lang-wrap">
          {LANGUAGES.map((l) => (
            <button key={l.code} onClick={() => store.setLang(l.code)} className={store.lang === l.code ? 'row g8 settings-lang-btn is-on' : 'row g8 settings-lang-btn'}>
              <LangFlag code={l.code} size={20} />{l.name}
            </button>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.myAddress')}>
        <div onClick={copy} className="tap glass row between settings-tile">
          <span className="settings-addr-text">{shortAddr(pub, 10, 10)}</span>
          <span className={copied ? 'settings-addr-copy is-copied' : 'settings-addr-copy'}>{copied ? t('common.copied') : t('common.copy')}</span>
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
