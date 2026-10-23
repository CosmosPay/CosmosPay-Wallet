import type { WalletStore } from '@/state/store';
import { Icon } from '@/ui/Icon';
import { cx } from '@/lib/cx';
import { fmt, pct } from '@/lib/format';
import { widthRung } from '@/lib/rung';
import { holdingStats } from '@/lib/portfolio';
import '@/styles/ui/meter.css';
import '@/styles/features/wallet/asset-stats.css';

/**
 * Two cards under an asset's balance — what the holding moved in 24 hours, in dollars, and
 * its share of everything the wallet holds, with a bar — after the asset screen of the
 * Dribbble "Crypto Wallet App · Dark Mode" shot. A card whose figure is unknown is left out
 * rather than drawn with a dash; with neither known — or nothing held, where "+$0.00" and
 * "0%" are true and say nothing — nothing is drawn.
 */
export function AssetStats({
  store,
  value,
  change24h,
  total,
}: {
  store: WalletStore;
  value: number | null;
  change24h: number | null;
  total: number;
}) {
  const t = store.t;
  const { deltaUsd, share } = holdingStats(value, change24h, total);
  if (!value || (deltaUsd === null && share === null)) return null;
  const up = (deltaUsd ?? 0) >= 0;

  return (
    <div className="asset-stats">
      {deltaUsd !== null && change24h !== null && (
        <div className="asset-stat stagger-0">
          <span className={cx('asset-stat-icon', up ? 'is-up' : 'is-down')}>
            <Icon name={up ? 'trend-up' : 'trend-down'} size={16} />
          </span>
          <span className="asset-stat-label">{t('asset.change24h')}</span>
          <span className={cx('asset-stat-value', up ? 'is-up' : 'is-down')}>
            {up ? '+' : '−'}${fmt(Math.abs(deltaUsd), 2)}
          </span>
          <span className="asset-stat-sub">{pct(change24h)}</span>
        </div>
      )}
      {share !== null && (
        <div className="asset-stat stagger-1">
          <span className="asset-stat-icon">
            <Icon name="chart" size={16} />
          </span>
          <span className="asset-stat-label">{t('asset.share')}</span>
          <span className="asset-stat-value">{fmt(share * 100, 2)}%</span>
          <span className="meter asset-stat-meter">
            <span className={cx('meter-fill', widthRung(share))} />
          </span>
        </div>
      )}
    </div>
  );
}
