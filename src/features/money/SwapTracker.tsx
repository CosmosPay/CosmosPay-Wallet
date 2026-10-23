import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { Icon } from '@/ui/Icon';
import { ExternalLink } from '@/ui/ExternalLink';
import { fetchIntentsStatus, trackerState, type IntentsProgress } from '@/lib/intentsStatus';
import { INTENTS_POLL_MS } from '@/constants/swap';
import { cx } from '@/lib/cx';
import '@/styles/features/money/swap-tracker.css';

/**
 * A NEAR Intents swap followed to its end on the success screen: four steps — deposit sent,
 * deposit seen, swapping, delivered — filling in as 1Click reports them, then the outcome.
 * Polls until the swap can no longer change or the screen is left. Display only: what moves
 * the money is NEAR Intents, on-chain; see `lib/intentsStatus.ts`.
 */
export function SwapTracker({
  store,
  track,
}: {
  store: WalletStore;
  track: { depositAddress: string; memo: string | null; asset: string; chain: string; etaSeconds: number };
}) {
  const t = store.t;
  const [progress, setProgress] = useState<IntentsProgress | null>(null);
  const state = trackerState(progress?.status ?? 'PENDING_DEPOSIT');
  const finished = state.outcome !== null;

  useEffect(() => {
    if (finished) return;
    let cancelled = false;
    const poll = async () => {
      const next = await fetchIntentsStatus(track.depositAddress, track.memo);
      if (!cancelled && next) setProgress(next);
    };
    void poll();
    const id = setInterval(poll, INTENTS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [finished, track.depositAddress, track.memo]);

  const steps = [t('track.sent'), t('track.seen'), t('track.swapping'), t(`track.done.${state.outcome ?? 'ok'}`)];
  const tx = progress?.destinationTx[0];

  return (
    <section className={cx('swap-track', state.outcome && `is-${state.outcome}`)} aria-live="polite">
      <div className="swap-track-head">
        <span className="swap-track-title">{t('track.title')}</span>
        {!finished && <span className="swap-track-eta">~{track.etaSeconds} s</span>}
      </div>
      <ol className="swap-track-steps">
        {steps.map((label, i) => {
          const complete = i < state.done;
          const current = i === state.done && !finished;
          return (
            <li key={label} className={cx('swap-track-step', complete && 'is-done', current && 'is-current')}>
              <span className="swap-track-dot">
                {complete ? (
                  <Icon name={i === 3 && state.outcome !== 'ok' ? 'alert' : 'check'} size={14} />
                ) : (
                  <span className="swap-track-pulse" />
                )}
              </span>
              <span className="swap-track-label">{label}</span>
            </li>
          );
        })}
      </ol>
      {state.outcome === 'ok' && progress?.amountOut && (
        <div className="swap-track-result">
          {t('track.received', { amount: progress.amountOut, asset: track.asset, chain: t(`xswap.chain.${track.chain}`) })}
        </div>
      )}
      {state.outcome === 'refunded' && <div className="swap-track-result">{t('track.refundedMsg')}</div>}
      {tx?.explorerUrl && (
        <ExternalLink href={tx.explorerUrl} className="swap-track-link">
          {t('track.viewPayout')} <Icon name="external" size={14} />
        </ExternalLink>
      )}
    </section>
  );
}
