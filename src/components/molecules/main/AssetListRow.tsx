import { AssetLogo, assetMeta } from '@/components/parts';
import { fmt, trim, pct } from '@/lib/format';
import type { AssetRow } from '@/lib/portfolio';
import { useAnimatedNumber } from '@/components/screens/main/shared';
import '@/styles/screens/main/home.css';

/** One holding row on Home: logo + name/amount and animated value + 24h change + favourite star.
 *  Change colour and the star use modifier classes; animation-delay stays inline (per index). */
export function AssetListRow({ row, chg, fav, onFav, onClick, delay = 0 }: { row: AssetRow; chg?: number; fav?: boolean; onFav?: () => void; onClick: () => void; delay?: number }) {
  const m = assetMeta(row.code);
  const shownValue = useAnimatedNumber(row.value ?? 0);
  const shownChg = useAnimatedNumber(chg ?? 0);
  return (
    <div onClick={onClick} className="tap home-asset-row" style={{ animationDelay: `${delay}s` }}>
      <div className="row g12 min0">
        <AssetLogo code={row.code} size={34} />
        <div className="col g2">
          <span className="home-asset-name">{m.name}</span>
          <span className="t-dim-12">{trim(row.amount, 4)} {row.code}</span>
        </div>
      </div>
      <div className="row g10 shrink0">
        <div className="col g2 home-asset-values">
          <span className="home-asset-value">
            {row.value !== null ? '$' + fmt(shownValue, 2) : '—'}
          </span>
          {chg !== undefined && (
            <span className={chg >= 0 ? 'home-asset-chg is-up' : 'home-asset-chg is-down'}>{pct(shownChg)}</span>
          )}
        </div>
        {onFav && (
          <span
            onClick={(e) => { e.stopPropagation(); onFav(); }}
            title="Favorito"
            className={fav ? 'tap home-asset-fav is-fav' : 'tap home-asset-fav'}
          >
            {fav ? '★' : '☆'}
          </span>
        )}
      </div>
    </div>
  );
}
