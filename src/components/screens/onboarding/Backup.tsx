import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar } from '@/components/parts';
import { copyText } from '@/lib/clipboard';
import { TERMS_URL } from '@/lib/config';
import { COPY_FEEDBACK_MS } from '@/constants/onboarding';
import { CheckRow, Desc, WordCell } from '@/components/molecules/onboarding';
import '@/styles/screens/onboarding/backup.css';

export function Backup({ store }: { store: WalletStore }) {
  const t = store.t;
  const [saved, setSaved] = useState(false);
  const [terms, setTerms] = useState(false);
  const [copied, setCopied] = useState(false);
  const words = store.draftMnemonic.split(' ');

  const copy = async () => {
    await copyText(store.draftMnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };

  return (
    <div className="scr screen">
      <BackBar title={t('backup.title')} onBack={() => store.setScreen('welcome')} />
      <Desc className="backup-desc">{t('backup.desc')}</Desc>
      <div className="backup-warning">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="backup-warning-icon">
          <path d="M12 3l9 16H3l9-16z" stroke="#ff7a7a" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M12 10v4M12 17h.01" stroke="#ff7a7a" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span className="backup-warning-text">{t('backup.warning')}</span>
      </div>
      <div className="ob-word-grid backup-grid">
        {words.map((w, i) => (
          <WordCell key={i} n={i + 1} className="glass">
            {w}
          </WordCell>
        ))}
      </div>
      <button onClick={copy} className={copied ? 'glass-soft backup-copy is-copied' : 'glass-soft backup-copy'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {copied ? t('common.copied') : t('backup.copy')}
      </button>
      <CheckRow on={saved} onToggle={() => setSaved((s) => !s)} className="backup-check-saved">
        {t('backup.saved')}
      </CheckRow>
      {/* Sole-responsibility + Terms acceptance — required before continuing.
          The T&C part is a real link (opens in a new tab, doesn't toggle the box). */}
      <CheckRow on={terms} onToggle={() => setTerms((s) => !s)} className="backup-check-terms">
        {t('backup.terms')}
        <a
          href={TERMS_URL}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="backup-terms-link"
        >
          {t('backup.termsLink')}
        </a>
        .
      </CheckRow>
      <PrimaryButton disabled={!saved || !terms} onClick={() => store.beginVerify()}>
        {t('common.continue')}
      </PrimaryButton>
    </div>
  );
}
