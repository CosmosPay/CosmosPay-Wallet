import { createPortal } from 'react-dom';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { WordCell } from '@/features/onboarding/WordCell';
import { useWordDrag } from '@/features/onboarding/useWordDrag';
import '@/styles/features/onboarding/verify.css';
import { cx } from '@/lib/cx';

export function Verify({ store }: { store: WalletStore }) {
  const t = store.t;
  const words = store.draftMnemonic.split(' ');
  const tIdx = store.verifyTargets.map((tg) => tg.index);
  const used = Object.values(store.verifyFilled);
  // Drag a word to its gap, a placed one to another gap or back to the bank — or tap, as before.
  const { drag, ghostRef, handlers, tap } = useWordDrag((source, to) =>
    to === 'bank' ? store.tapSlot(source.from as number) : store.placeWord(source.word, to, source.from),
  );
  const lifted = (from: number | null, word: string) => drag?.source.from === from && drag.source.word === word;

  return (
    <div className="scr screen col">
      <ScreenHeader title={t('verify.title')} desc={t('verify.desc')} onBack={store.goBack} />
      <div className={cx('ob-word-grid verify-grid', drag && 'is-dragging')}>
        {words.map((w, i) => {
          const isT = tIdx.includes(i);
          const filledWord = store.verifyFilled[i];
          // Three looks: a word already shown (fixed), a gap to fill (empty), a gap filled
          // by a tap or a drop (filled — tapping it again empties it, dragging moves it).
          if (!isT) {
            return (
              <WordCell key={i} n={i + 1} className="verify-word is-fixed">
                {w}
              </WordCell>
            );
          }
          const isOver = drag?.over === i;
          return filledWord ? (
            <WordCell
              key={i}
              n={i + 1}
              drop={String(i)}
              onClick={tap(() => store.tapSlot(i))}
              drag={handlers({ word: filledWord, from: i })}
              className={cx('verify-word is-filled', isOver && 'is-over', lifted(i, filledWord) && 'is-lifted')}
            >
              {filledWord}
            </WordCell>
          ) : (
            <WordCell
              key={i}
              n={i + 1}
              drop={String(i)}
              className={cx('verify-word is-empty', isOver && 'is-over')}
            >
              {' '}
            </WordCell>
          );
        })}
      </div>
      <p className="verify-hint">{t('verify.dragOrTap')}</p>
      <div data-word-drop="bank" className={cx('verify-bank', drag?.over === 'bank' && 'is-over')}>
        {store.verifyBank.map((w, i) => {
          const u = used.includes(w);
          return (
            <button
              key={i}
              type="button"
              disabled={u}
              onClick={tap(() => store.tapChip(w))}
              {...(u ? {} : handlers({ word: w, from: null }))}
              className={cx('verify-chip', u && 'is-used', lifted(null, w) && 'is-lifted')}
            >
              {w}
            </button>
          );
        })}
      </div>
      {/* The word under the finger while it is dragged; aria-hidden — the tap is the way in.
          Out of the screen, in the shell: the screen's entrance animates a transform, and a
          fixed element inside one is placed against it instead of the window. */}
      {createPortal(
        <div
          ref={ghostRef}
          aria-hidden="true"
          className={cx('verify-ghost', drag && 'is-on', drag?.settling && 'is-settling')}
        >
          {drag?.source.word}
        </div>,
        document.querySelector('.shell-root') ?? document.body,
      )}
      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!store.verifyOk} onClick={() => store.setScreen('profile-setup')}>
          {t('verify.confirm')}
        </PrimaryButton>
      </div>
    </div>
  );
}
