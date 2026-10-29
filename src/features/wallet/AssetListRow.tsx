import { AssetLogo, NetworkLogo, assetMeta } from '@/ui/AssetLogo';
import { fmt, trim, pct } from '@/lib/format';
import type { AssetRow } from '@/lib/portfolio';
import { isHomeCoin } from '@/lib/logos';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { staggerClass } from '@/lib/stagger';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/asset-row.css';

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
  const net = row.network ?? row.chain ?? 'stellar';
  // Every asset but a coin on its home network wears its network's mark: ETH on Base is not ETH.
  const badge = !isHomeCoin(net, row.code);
  return (
    <button type="button" onClick={onClick} className={cx('asset-row', staggerClass(index))}>
      <span className="asset-row-logo">
        <AssetLogo code={row.code} size={44} />
        {badge && (
          <span className="asset-row-net" aria-hidden="true">
            <NetworkLogo network={net} size={20} />
          </span>
        )}
      </span>
      <span className="asset-row-main">
        <span className="asset-row-name">
          {m.name}
          <span className="sr-only"> · {network}</span>
        </span>
        <span className="asset-row-sub">
          {/* Off Stellar the network is said: ETH on Base and ETH on Ethereum are two holdings. */}
          {net !== 'stellar' && <span aria-hidden="true">{network}</span>}
          {row.price !== null && <span className="asset-row-sub-price">${fmt(row.price, row.price >= 1 ? 2 : 4)}</span>}
          {chg !== undefined && <span className={cx('asset-row-chg', chg >= 0 ? 'is-up' : 'is-down')}>{pct(shownChg)}</span>}
        </span>
      </span>
      {/* A PC window's table (home.css) gives the price and the day's move their own columns;
          on a phone these are not drawn, and they repeat what the line above already says. */}
      <span className="asset-row-col is-price" aria-hidden="true">
        {row.price !== null ? '$' + fmt(row.price, row.price >= 1 ? 2 : 4) : '—'}
      </span>
      <span className={cx('asset-row-col is-change', chg !== undefined && (chg >= 0 ? 'is-up' : 'is-down'))} aria-hidden="true">
        {chg !== undefined ? pct(shownChg) : '—'}
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
