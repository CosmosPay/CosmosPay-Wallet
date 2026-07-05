import type { WalletStore } from '@/components/store';
import { BackBar, Logo } from '@/components/parts';
import { APP_VERSION } from '@/lib/config';
import { buildKind, platformName } from '@/lib/platform';
import '@/styles/screens/settings/about.css';

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
      <BackBar title={t('about.title')} onBack={() => store.back(store.session ? 'profile' : 'home')} />
      <div className="about-hero">
        <Logo size={84} />
        <div className="about-title">Cosmos Pay</div>
        <div className="about-tagline">{t('about.tagline')}</div>
      </div>
      <div className="glass about-card">
        {rows.map((r) => (
          <div key={r[0]} className="about-row">
            <span className="about-row-label">{r[0]}</span>
            <span className={r[0] === t('about.platform') ? 'about-row-value about-row-value--cap' : 'about-row-value'}>{r[1]}</span>
          </div>
        ))}
      </div>
      <div className="about-desc">{t('about.desc')}</div>
      <div className="about-spacer" />
      <div className="about-footer">Un producto de Cosmos · v{APP_VERSION}</div>
    </div>
  );
}
