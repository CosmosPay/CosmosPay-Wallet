import { AssetLogo, assetMeta } from '@/ui/AssetLogo';
import { fmt, trim, pct } from '@/lib/format';
import type { AssetRow } from '@/lib/portfolio';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { staggerClass } from '@/lib/stagger';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/home.css';

/** One holding row on Home: logo + name/amount and animated value + 24h change + favourite star.
 *  `network` names the chain of a holding that is not on Stellar, so USDC on Solana and USDC
 *  on Stellar read as two things. Every variant is a modifier class; `index` picks the
 *  entrance-delay rung. */
export function AssetListRow({ row, chg, fav, onFav, onClick, index = 0, network }: { row: AssetRow; chg?: number; fav?: boolean; onFav?: () => void; onClick: () => void; index?: number; network?: string }) {
  const m = assetMeta(row.code);
  const shownValue = useAnimatedNumber(row.value ?? 0);
  const shownChg = useAnimatedNumber(chg ?? 0);
  return (
    <div onClick={onClick} className={cx('tap home-asset-row', staggerClass(index))}>
      <div className="row g12 min0">
        <AssetLogo code={row.code} size={34} />
        <div className="col g2">
          <span className="home-asset-name">{m.name}</span>
          <span className="t-dim-12">
            {trim(row.amount, 4)} {row.code}
            {network && <span className="home-asset-net"> · {network}</span>}
          </span>
        </div>
      </div>
      <div className="row g10 shrink0">
        <div className="col g2 home-asset-values">
          <span className="home-asset-value">
            {row.value !== null ? '$' + fmt(shownValue, 2) : '—'}
          </span>
          {chg !== undefined && (
            <span className={cx('home-asset-chg', chg >= 0 ? 'is-up' : 'is-down')}>{pct(shownChg)}</span>
          )}
        </div>
        {onFav && (
          <span
            onClick={(e) => { e.stopPropagation(); onFav(); }}
            title="Favorito"
            className={cx('tap home-asset-fav', fav && 'is-fav')}
          >
            {fav ? '★' : '☆'}
          </span>
        )}
      </div>
    </div>
  );
}
