import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar } from '@/components/parts';
import { readText } from '@/lib/clipboard';
import { isValidMnemonic, isValidSecret } from '@/lib/wallet';
import { Criterion } from './shared';

export function Import({ store }: { store: WalletStore }) {
  const t = store.t;
  const txt = store.importText.trim();
  const valid = txt.length > 0 && (isValidMnemonic(txt) || isValidSecret(txt));

  return (
    <div className="scr screen">
      <BackBar title={t('import.title')} onBack={() => store.setScreen('welcome')} />
      <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '14px 0 18px' }}>
        {t('import.desc')}
      </div>
      <textarea
        value={store.importText}
        onChange={(e) => store.setImportText((e.target as HTMLTextAreaElement).value)}
        placeholder="ribbon planet silver orbit … &#10;o &#10;SD…"
        rows={4}
        className="glass" style={{ width: '100%', borderRadius: '16px', padding: '16px', color: 'var(--text)', fontSize: '15px', fontWeight: 600, resize: 'none', outline: 'none', lineHeight: 1.7, marginBottom: '8px' }}
      />
      {/* Live validity criterion (same pattern as the password checklist):
          grey while empty, green ✓ when valid, red ✗ when invalid. */}
      <div style={{ margin: '2px 2px 12px' }}>
        <Criterion met={valid} bad={txt.length > 0 && !valid}>
          {txt.length > 0 && !valid ? t('import.invalid') : t('import.valid')}
        </Criterion>
      </div>
      <button
        onClick={async () => store.setImportText(await readText())}
        className="glass-soft" style={{ width: '100%', height: '54px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', border: 'none', borderRadius: '999px', fontSize: '14px', fontWeight: 800, cursor: 'pointer', color: 'var(--text)', marginTop: '6px', marginBottom: '22px' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <rect x="6" y="4" width="12" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5V6H9V4.5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        {t('import.paste')}
      </button>
      <PrimaryButton disabled={!valid} onClick={() => store.submitImport()}>
        {t('import.cta')}
      </PrimaryButton>
    </div>
  );
}
