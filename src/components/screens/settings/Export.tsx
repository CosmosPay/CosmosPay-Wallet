import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar, Spinner } from '@/components/parts';
import { Reveal } from '@/components/molecules/settings/Reveal';
import { useBusy, useCopied } from '@/components/hooks';
import '@/styles/screens/settings/export.css';

/* ------------------------------ EXPORT ------------------------------ */
export function Export({ store }: { store: WalletStore }) {
  const t = store.t;
  const [pwd, setPwd] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, run] = useBusy();
  const [copied, copy] = useCopied();

  const unlock = () =>
    run(async () => {
      if (await store.checkPassword(pwd)) setRevealed(true);
      else store.flash(t('pwd.label') + ' ✗', 'err');
    });

  const mnemonic = store.session?.mnemonic ?? null;
  const secret = store.session?.secret ?? '';

  return (
    <div className="scr screen col pb-30">
      <BackBar title={t('export.title')} onBack={() => store.back(store.session ? 'profile' : 'home')} />

      <div className="export-warning">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="export-warning-icon"><path d="M12 3l9 16H3l9-16z" stroke="#ff7a7a" strokeWidth="1.8" strokeLinejoin="round" /><path d="M12 10v4M12 17h.01" stroke="#ff7a7a" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <span className="export-warning-text">
          {t('export.warning')}
        </span>
      </div>

      {!revealed ? (
        <>
          <div className="export-hint">
            {t('export.enterPwd')}
          </div>
          <input type="password" value={pwd} placeholder={t('pwd.label')} onChange={(e) => setPwd((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} className="input export-pwd-input" />
          <PrimaryButton disabled={!pwd || busy} onClick={unlock}>{busy ? <Spinner /> : t('export.reveal')}</PrimaryButton>
        </>
      ) : (
        <>
          {mnemonic ? (
            <Reveal title={t('export.phraseTitle')} value={mnemonic} mono={false} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copied === 'phrase'} onCopy={() => copy(mnemonic, 'phrase')} grid />
          ) : (
            <div className="glass export-nophrase">
              {t('export.noPhrase')}
            </div>
          )}
          <Reveal title={t('export.secretTitle')} value={secret} mono copyLabel={t('common.copy')} copiedLabel={t('common.copied')} copied={copied === 'secret'} onCopy={() => copy(secret, 'secret')} />
          <div className="export-compat">
            {t('export.compat')}
          </div>
        </>
      )}
    </div>
  );
}

