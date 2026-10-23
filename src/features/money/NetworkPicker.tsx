import type { WalletStore } from '@/state/store';
import { ChainLogo } from '@/ui/ChainLogo';
import type { SwapNetwork } from '@/lib/swapRoute';
import { cx } from '@/lib/cx';
import '@/styles/features/money/network-picker.css';

/**
 * A row of networks to choose from, each with its own mark — the swap screen's "from" and
 * "to", and the receive screen's tabs. Scrolls sideways when the seven do not fit.
 */
export function NetworkPicker({
  store,
  label,
  value,
  options,
  onPick,
}: {
  store: WalletStore;
  label?: string;
  value: SwapNetwork;
  options: readonly SwapNetwork[];
  onPick: (n: SwapNetwork) => void;
}) {
  const t = store.t;
  return (
    <div className="net-picker" role="group" aria-label={label}>
      {label && <div className="net-picker-label">{label}</div>}
      <div className="chip-row net-picker-row">
        {options.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPick(n)}
            aria-pressed={value === n}
            className={cx('chip net-picker-chip', value === n && 'is-on')}
          >
            <ChainLogo chain={n} size={20} />
            {t(`xswap.chain.${n}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
