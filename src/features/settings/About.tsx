import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { Logo } from '@/ui/Logo';
import { APP_VERSION } from '@/constants/app';
import { buildKind, platformName } from '@/lib/platform';
import '@/styles/features/settings/about.css';
import { cx } from '@/lib/cx';
import { KVRow } from '@/ui/KVRow';

/* ------------------------------ ABOUT ------------------------------- */
export function About({ store }: { store: WalletStore }) {
  const t = store.t;
  const kind = buildKind();
  const buildLabel = kind === 'ext' ? t('about.buildExt') : kind === 'app' ? t('about.buildApp') : t('about.buildWeb');
  const rows: [string, string][] = [
    [t('about.version'), 'v' + APP_VERSION],
    [t('about.build'), buildLabel],
  ];
  if (kind === 'app') rows.push([t('about.platform'), platformName()]);

  return (
    <div className="scr screen col pb-30">
      <BackBar title={t('about.title')} onBack={store.goBack} />
      <div className="about-hero">
        <Logo size={84} />
        <div className="about-title">Cosmos Pay</div>
        <div className="about-tagline">{t('about.tagline')}</div>
      </div>
      <div className="glass kv-card">
        {rows.map((r) => (
          <KVRow
            key={r[0]}
            label={r[0]}
            value={<span className={cx(r[0] === t('about.platform') && 'about-row-value--cap')}>{r[1]}</span>}
          />
        ))}
      </div>
      <div className="about-desc">{t('about.desc')}</div>
      <div className="spacer" />
      <div className="about-footer">Un producto de Cosmos · v{APP_VERSION}</div>
    </div>
  );
}
