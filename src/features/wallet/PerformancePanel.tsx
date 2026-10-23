import type { WalletStore } from '@/state/store';
import { AssetLogo, assetMeta } from '@/ui/AssetLogo';
import { Icon } from '@/ui/Icon';
import { fmt, pct } from '@/lib/format';
import { widthRung } from '@/lib/rung';
import { allocationByAsset, allocationByNetwork, movers } from '@/lib/performance';
import type { AssetRow } from '@/lib/portfolio';
import { cx } from '@/lib/cx';
import '@/styles/ui/meter.css';
import '@/styles/features/wallet/performance.css';

/**
 * Where the portfolio sits and how it moved today: the split by asset (one stacked bar and
 * its legend), the split by network — the question a wallet on seven chains raises — and
 * the day's movers. Everything is read from the same rows and prices Home shows; nothing
 * here fetches.
 */
export function PerformancePanel({ store, rows }: { store: WalletStore; rows: AssetRow[] }) {
  const t = store.t;
  const byAsset = allocationByAsset(rows);
  const byNetwork = allocationByNetwork(rows);
  const moving = movers(rows, store.prices);
  const maxMove = Math.max(...moving.map((m) => Math.abs(m.change)), 1);
  const empty = byAsset.length === 0;

  if (empty) {
    return (
      <div className="perf-empty">
        <span className="perf-empty-icon">
          <Icon name="chart-bars" size={24} />
        </span>
        <div className="perf-empty-title">{t('perf.emptyTitle')}</div>
        <div className="desc">{t('perf.emptyDesc')}</div>
      </div>
    );
  }

  return (
    <>
      <div className="perf-card">
        <div className="perf-card-head">
          <span className="perf-card-title">{t('perf.byAsset')}</span>
          <span className="perf-card-note">{t('perf.share')}</span>
        </div>
        <div className="perf-stack" aria-hidden="true">
          {byAsset.map((a, i) => (
            <span key={a.key} className={cx('perf-stack-seg', `perf-c-${i}`, widthRung(a.share))} />
          ))}
        </div>
        <div className="perf-legend">
          {byAsset.map((a, i) => (
            <div key={a.key} className={cx('perf-legend-row', `stagger-${i}`)}>
              <span className={cx('perf-dot', `perf-c-${i}`)} />
              <span className="perf-legend-name">{a.code === '…' ? t('perf.other') : assetMeta(a.code).name}</span>
              <span className="perf-legend-pct">{fmt(a.share * 100, 1)}%</span>
              <span className="perf-legend-val">$ {fmt(a.value, 2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="perf-card">
        <div className="perf-card-head">
          <span className="perf-card-title">{t('perf.byNetwork')}</span>
        </div>
        {byNetwork.map((n, i) => (
          <div key={n.network} className={cx('perf-net-row', `stagger-${i}`)}>
            <AssetLogo code={n.network === 'stellar' ? 'XLM' : n.logo} size={28} />
            <span className="perf-net-main">
              <span className="perf-net-name">
                {n.network === 'stellar' ? t('xswap.chain.stellar') : t(`chains.net.${store.chainNet}.${n.network}`)}
              </span>
              <span className="meter">
                <span className={cx('meter-fill', widthRung(n.share))} />
              </span>
            </span>
            <span className="perf-net-val">$ {fmt(n.value, 2)}</span>
          </div>
        ))}
      </div>

      {moving.length > 0 && (
        <div className="perf-card">
          <div className="perf-card-head">
            <span className="perf-card-title">{t('perf.movers')}</span>
            <span className="perf-card-note">24 h</span>
          </div>
          {moving.map((m, i) => (
            <div key={m.code} className={cx('perf-move-row', `stagger-${i}`)}>
              <AssetLogo code={m.code} size={28} />
              <span className="perf-move-code">{m.code}</span>
              <span className="meter perf-move-meter">
                <span className={cx('meter-fill', m.change >= 0 ? 'is-up' : 'is-down', widthRung(Math.abs(m.change) / maxMove))} />
              </span>
              <span className={cx('perf-move-pct', m.change >= 0 ? 't-up' : 't-down')}>{pct(m.change)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
