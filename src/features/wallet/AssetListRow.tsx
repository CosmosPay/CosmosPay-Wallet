import { AssetLogo, assetMeta } from '@/ui/AssetLogo';
import { fmt, trim, pct } from '@/lib/format';
import type { AssetRow } from '@/lib/portfolio';
import type { OtherChain } from '@/constants/chains';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { staggerClass } from '@/lib/stagger';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/asset-row.css';

/** The coin each network is named by: the badge on a token that lives there. */
const NETWORK_COIN: Record<'stellar' | OtherChain, string> = { stellar: 'XLM', solana: 'SOL', monad: 'MON' };

/**
 * One holding, as the Figma lists it: the token's logo — with its network's coin on its corner,
 * so USDC on Solana and USDC on Stellar never read as one thing — the name over its price and
 * 24h change, and the value over the amount. `network` is the network's name, said to a screen
 * reader where the badge only shows it.
 */
export function AssetListRow({
  row,
  chg,
  network,
  onClick,
  index = 0,
}: {
  row: AssetRow;
  chg?: number;
  network: string;
  onClick: () => void;
  index?: number;
}) {
  const m = assetMeta(row.code);
  const shownValue = useAnimatedNumber(row.value ?? 0);
  const shownChg = useAnimatedNumber(chg ?? 0);
  const net = row.chain ?? 'stellar';
  const badge = NETWORK_COIN[net] !== row.code;
  return (
    <button type="button" onClick={onClick} className={cx('asset-row', staggerClass(index))}>
      <span className="asset-row-logo">
        <AssetLogo code={row.code} size={44} />
        {badge && (
          <span className="asset-row-net" aria-hidden="true">
            <AssetLogo code={NETWORK_COIN[net]} size={20} />
          </span>
        )}
      </span>
      <span className="asset-row-main">
        <span className="asset-row-name">
          {m.name}
          <span className="sr-only"> · {network}</span>
        </span>
        <span className="asset-row-sub">
          {row.price !== null && <span>${fmt(row.price, row.price >= 1 ? 2 : 4)}</span>}
          {chg !== undefined && <span className={cx('asset-row-chg', chg >= 0 ? 'is-up' : 'is-down')}>{pct(shownChg)}</span>}
        </span>
      </span>
      <span className="asset-row-end">
        <span className="asset-row-value">{row.value !== null ? '$' + fmt(shownValue, 2) : '—'}</span>
        <span className="asset-row-amount">
          {trim(row.amount, 6)} {row.code}
        </span>
      </span>
    </button>
  );
}
