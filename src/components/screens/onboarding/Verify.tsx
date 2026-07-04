import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar } from '@/components/parts';

export function Verify({ store }: { store: WalletStore }) {
  const t = store.t;
  const words = store.draftMnemonic.split(' ');
  const tIdx = store.verifyTargets.map((tg) => tg.index);
  const used = Object.values(store.verifyFilled);

  return (
    <div className="scr screen">
      <BackBar title={t('verify.title')} onBack={() => store.setScreen('backup')} />
      <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '14px 0 18px' }}>
        {t('verify.desc')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '22px' }}>
        {words.map((w, i) => {
          const isT = tIdx.includes(i);
          const filledWord = store.verifyFilled[i];
          let bg = 'var(--surface)';
          let border = '1px solid var(--glass-border)';
          let color = C.inkSoft;
          let content: string = w;
          let onClick = () => {};
          if (isT) {
            if (filledWord) {
              bg = 'var(--avatar-brand)';
              border = `1px solid ${C.accent}`;
              color = C.accent;
              content = filledWord;
              onClick = () => store.tapSlot(i);
            } else {
              bg = 'transparent';
              border = '1px dashed rgba(255,255,255,.22)';
              color = C.dim;
              content = '#' + (i + 1);
            }
          }
          return (
            <div key={i} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '9px', background: bg, border, borderRadius: '13px', padding: '12px 13px', cursor: isT ? 'pointer' : 'default', minHeight: '45px' }}>
              <span style={{ fontSize: '12px', color: C.accent, fontWeight: 700, width: '16px', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
              <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-.2px', color }}>{content}</span>
            </div>
          );
        })}
      </div>
      <div className="label-up" style={{ marginBottom: '12px' }}>{t('verify.tapToSelect')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '24px' }}>
        {store.verifyBank.map((w, i) => {
          const u = used.includes(w);
          return (
            <div key={i} onClick={u ? undefined : () => store.tapChip(w)} style={{ background: u ? 'var(--surface-2)' : 'var(--glass-soft-bg)', border: '1px solid var(--glass-soft-border)', borderRadius: '12px', padding: '11px 18px', fontSize: '15px', fontWeight: 700, cursor: u ? 'default' : 'pointer', color: u ? C.dim : 'var(--text)' }}>
              {w}
            </div>
          );
        })}
      </div>
      <PrimaryButton disabled={!store.verifyOk} onClick={() => store.setScreen('profile-setup')}>
        {t('verify.confirm')}
      </PrimaryButton>
    </div>
  );
}
