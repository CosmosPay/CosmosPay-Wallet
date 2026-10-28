import { ExternalLink } from '@/ui/ExternalLink';
import type { WalletStore } from '@/state/store';
import { useKeptState } from '@/hooks/useKeptState';
import { KEPT_INPUT } from '@/constants/keptInputs';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { useCopied } from '@/hooks/useCopied';
import { TERMS_URL } from '@/constants/app';
import { CheckRow } from '@/ui/CheckRow';
import { WordCell } from '@/features/onboarding/WordCell';
import '@/styles/features/onboarding/backup.css';

export function Backup({ store }: { store: WalletStore }) {
  const t = store.t;
  // Kept while the person goes on to the check and back; a new phrase clears `saved`.
  const [saved, setSaved] = useKeptState(KEPT_INPUT.backupSaved, false);
  const [terms, setTerms] = useKeptState(KEPT_INPUT.backupTerms, false);
  const [copied, copy] = useCopied();
  const words = store.draftMnemonic.split(' ');

  return (
    <div className="scr screen col">
      <ScreenHeader title={t('backup.title')} desc={t('backup.desc')} onBack={store.goBack} />
      <Notice tone="danger" className="backup-warning">
        {t('backup.warning')}
      </Notice>
      <div className="ob-word-grid backup-grid">
        {words.map((w, i) => (
          <WordCell key={i} n={i + 1}>
            {w}
          </WordCell>
        ))}
      </div>
      <GhostButton onClick={() => copy(store.draftMnemonic)} className="backup-copy">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {copied ? t('common.copied') : t('backup.copy')}
      </GhostButton>
      <CheckRow on={saved} onToggle={() => setSaved((s) => !s)}>
        {t('backup.saved')}
      </CheckRow>
      {/* Sole-responsibility + Terms acceptance — required before continuing.
          The T&C part is a real link (opens in a new tab, doesn't toggle the box). */}
      <CheckRow on={terms} onToggle={() => setTerms((s) => !s)}>
        {t('backup.terms')}
        <ExternalLink href={TERMS_URL}>{t('backup.termsLink')}</ExternalLink>.
      </CheckRow>
      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!saved || !terms} onClick={() => store.beginVerify()}>
          {t('common.continue')}
        </PrimaryButton>
      </div>
    </div>
  );
}
