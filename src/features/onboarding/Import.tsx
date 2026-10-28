import type { WalletStore } from '@/state/store';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { readText } from '@/lib/clipboard';
import { isValidMnemonic, isValidSecret } from '@/lib/wallet';
import { Criterion } from '@/features/onboarding/Criterion';
import '@/styles/features/onboarding/import.css';

export function Import({ store }: { store: WalletStore }) {
  const t = store.t;
  const txt = store.importText.trim();
  const valid = txt.length > 0 && (isValidMnemonic(txt) || isValidSecret(txt));

  return (
    <div className="scr screen col">
      <ScreenHeader title={t('import.title')} desc={t('import.desc')} onBack={store.goBack} />
      <textarea
        value={store.importText}
        onChange={(e) => store.setImportText((e.target as HTMLTextAreaElement).value)}
        placeholder="ribbon planet silver orbit … &#10;o &#10;SD…"
        aria-label={t('import.title')}
        rows={4}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="glass import-textarea"
      />
      {/* Live validity criterion (same pattern as the password checklist):
          grey while empty, green ✓ when valid, red ✗ when invalid. */}
      <div className="import-criterion">
        <Criterion met={valid} bad={txt.length > 0 && !valid}>
          {txt.length > 0 && !valid ? t('import.invalid') : t('import.valid')}
        </Criterion>
      </div>
      <GhostButton onClick={async () => store.setImportText(await readText())}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="6" y="4" width="12" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5V6H9V4.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        {t('import.paste')}
      </GhostButton>
      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!valid} onClick={() => store.submitImport()}>
          {t('import.cta')}
        </PrimaryButton>
      </div>
    </div>
  );
}
