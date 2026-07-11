import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar } from '@/components/parts';
import { Desc, WordCell } from '@/components/molecules/onboarding';
import '@/styles/screens/onboarding/verify.css';

export function Verify({ store }: { store: WalletStore }) {
  const t = store.t;
  const words = store.draftMnemonic.split(' ');
  const tIdx = store.verifyTargets.map((tg) => tg.index);
  const used = Object.values(store.verifyFilled);

  return (
    <div className="scr screen">
      <BackBar title={t('verify.title')} onBack={() => store.setScreen('backup')} />
      <Desc>{t('verify.desc')}</Desc>
      <div className="ob-word-grid verify-grid">
        {words.map((w, i) => {
          const isT = tIdx.includes(i);
          const filledWord = store.verifyFilled[i];
          // three visual states → modifier classes (fixed / empty slot / filled slot)
          let mod = 'verify-word--fixed';
          let content: string = w;
          let onClick = () => {};
          if (isT) {
            if (filledWord) {
              mod = 'verify-word--filled';
              content = filledWord;
              onClick = () => store.tapSlot(i);
            } else {
              mod = 'verify-word--empty';
              content = '#' + (i + 1);
            }
          }
          return (
            <WordCell key={i} n={i + 1} onClick={onClick} className={`verify-word ${mod}`}>
              {content}
            </WordCell>
          );
        })}
      </div>
      <div className="label-up verify-hint">{t('verify.tapToSelect')}</div>
      <div className="verify-bank">
        {store.verifyBank.map((w, i) => {
          const u = used.includes(w);
          return (
            <div
              key={i}
              onClick={u ? undefined : () => store.tapChip(w)}
              className={u ? 'verify-chip is-used' : 'verify-chip'}
            >
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
