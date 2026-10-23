import { AssetLogo, assetMeta } from '@/ui/AssetLogo';
import { fmt, trim, pct } from '@/lib/format';
import type { AssetRow } from '@/lib/portfolio';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { staggerClass } from '@/lib/stagger';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/home.css';

/**
 * One holding, laid out as the design's asset row: the 48px logo; the name over its unit
 * price and 24h change; the holding's value over its amount on the right. A holding that is
 * not on Stellar carries its network as a badge on the logo and a word after its name, so
 * USDC on Arbitrum and USDC on Stellar read as two things.
 */
export function AssetListRow({
  row,
  chg,
  onClick,
  index = 0,
  network,
}: {
  row: AssetRow;
  chg?: number;
  onClick: () => void;
  index?: number;
  network?: string;
}) {
  const m = assetMeta(row.code);
  const shownValue = useAnimatedNumber(row.value ?? 0);
  return (
    <button type="button" onClick={onClick} className={cx('home-asset-row', staggerClass(index))}>
      <AssetLogo code={row.code} size={48} chain={row.chain ?? (row.isNative ? undefined : 'stellar')} />
      <span className="home-asset-main">
        <span className="home-asset-name">
          {m.name}
          {network && <span className="home-asset-net">{network}</span>}
        </span>
        <span className="home-asset-sub">
          <span>{row.price !== null ? `$ ${fmt(row.price, row.price < 1 ? 4 : 2)}` : '—'}</span>
          {chg !== undefined && (
            <span className={cx('home-asset-chg', chg >= 0 ? 'is-up' : 'is-down')}>{pct(chg)}</span>
          )}
        </span>
      </span>
      <span className="home-asset-values">
        <span className="home-asset-value">{row.value !== null ? `$ ${fmt(shownValue, 2)}` : '—'}</span>
        <span className="home-asset-amount">
          {trim(row.amount, 6)} {row.code}
        </span>
      </span>
    </button>
  );
}
