import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { WordCell } from '@/features/onboarding/WordCell';
import '@/styles/features/onboarding/verify.css';
import { cx } from '@/lib/cx';

export function Verify({ store }: { store: WalletStore }) {
  const t = store.t;
  const words = store.draftMnemonic.split(' ');
  const tIdx = store.verifyTargets.map((tg) => tg.index);
  const used = Object.values(store.verifyFilled);

  return (
    <div className="scr screen col">
      <ScreenHeader title={t('verify.title')} desc={t('verify.desc')} onBack={store.goBack} />
      <div className="ob-word-grid verify-grid">
        {words.map((w, i) => {
          const isT = tIdx.includes(i);
          const filledWord = store.verifyFilled[i];
          // Three looks: a word already shown (fixed), a gap to fill (empty), a gap filled
          // by a tap (filled — tapping it again empties it).
          if (!isT) {
            return (
              <WordCell key={i} n={i + 1} className="verify-word is-fixed">
                {w}
              </WordCell>
            );
          }
          return filledWord ? (
            <WordCell key={i} n={i + 1} onClick={() => store.tapSlot(i)} className="verify-word is-filled">
              {filledWord}
            </WordCell>
          ) : (
            <WordCell key={i} n={i + 1} className="verify-word is-empty">
              {' '}
            </WordCell>
          );
        })}
      </div>
      <p className="verify-hint">{t('verify.tapToSelect')}</p>
      <div className="verify-bank">
        {store.verifyBank.map((w, i) => {
          const u = used.includes(w);
          return (
            <button key={i} type="button" disabled={u} onClick={() => store.tapChip(w)} className={cx('verify-chip', u && 'is-used')}>
              {w}
            </button>
          );
        })}
      </div>
      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!store.verifyOk} onClick={() => store.setScreen('profile-setup')}>
          {t('verify.confirm')}
        </PrimaryButton>
      </div>
    </div>
  );
}
