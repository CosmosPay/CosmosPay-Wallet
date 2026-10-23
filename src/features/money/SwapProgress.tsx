import { createPortal } from 'react-dom';
import type { WalletStore } from '@/state/store';
import { AssetLogo } from '@/ui/AssetLogo';
import type { OtherChain } from '@/constants/chains';
import '@/styles/features/money/swap-progress.css';

type Side = { code: string; amount: string; chain: 'stellar' | OtherChain };

/** One class per dot: the beam's rhythm is a fixed ladder in the sheet, never a computed delay. */
const BEAM_DOTS = ['is-1', 'is-2', 'is-3', 'is-4', 'is-5'] as const;

/**
 * What a swap screen shows while its swap is in flight — signed, being sent, waiting on the
 * network — after the "Swapping" screen of the Dribbble "Crypto Wallet UI Kit · Enhanced
 * Swap" shot: the two tokens with a current running between them, and what is paid and
 * received. The screen renders it while `store.busy`; it holds no state and offers no way
 * out, because nothing about a swap can be taken back once it is signed. Portalled to <body>
 * for the reason `SlippageControl`'s sheet is: to cover the navigation, not sit under it.
 */
export function SwapProgress({ store, from, to }: { store: WalletStore; from: Side; to: Side }) {
  const t = store.t;
  return createPortal(
    <div className="swap-progress" role="status" aria-live="polite">
      <div className="swap-progress-stage">
        <span className="swap-progress-coin">
          <AssetLogo code={from.code} chain={from.chain} size={64} />
        </span>
        <span className="swap-progress-beam" aria-hidden="true">
          {BEAM_DOTS.map((d) => (
            <span key={d} className={`swap-progress-dot ${d}`} />
          ))}
        </span>
        <span className="swap-progress-coin is-to">
          <AssetLogo code={to.code} chain={to.chain} size={64} />
        </span>
      </div>
      <div className="swap-progress-title">{t('swapping.title')}</div>
      <div className="swap-progress-sub">{t('swapping.sub')}</div>
      <div className="swap-progress-card">
        <div className="swap-progress-side">
          <span className="swap-progress-label">{t('swap.pay')}</span>
          <span className="swap-progress-amount">
            {from.amount} {from.code}
          </span>
          <span className="swap-progress-chain">{t(`xswap.chain.${from.chain}`)}</span>
        </div>
        <span className="swap-progress-arrow" aria-hidden="true">
          →
        </span>
        <div className="swap-progress-side is-to">
          <span className="swap-progress-label">{t('swap.receiveEst')}</span>
          <span className="swap-progress-amount">
            {to.amount} {to.code}
          </span>
          <span className="swap-progress-chain">{t(`xswap.chain.${to.chain}`)}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
