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
  // Keyed off the union so a new BuildKind is a missing key rather than a silent
  // "Web app" on a build that is nothing of the sort.
  const BUILD_KEYS: Record<typeof kind, string> = {
    web: 'about.buildWeb',
    ext: 'about.buildExt',
    app: 'about.buildApp',
    desktop: 'about.buildDesktop',
  };
  const rows: [string, string][] = [
    [t('about.version'), 'v' + APP_VERSION],
    [t('about.build'), t(BUILD_KEYS[kind])],
  ];
  // Both Tauri builds know their OS; a browser tab does not, and `platformName()` would
  // only report the string 'web' back at a row already labelled "Web app".
  if (kind === 'app' || kind === 'desktop') rows.push([t('about.platform'), platformName()]);

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
