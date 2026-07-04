import type { WalletStore } from '@/components/store';
import { C, BackBar, Logo } from '@/components/parts';
import { APP_VERSION } from '@/lib/config';
import { buildKind, platformName } from '@/lib/platform';

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
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 30px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('about.title')} onBack={() => store.back(store.session ? 'profile' : 'home')} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', margin: '24px 0 26px' }}>
        <Logo size={84} />
        <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '16px' }}>Cosmos Pay</div>
        <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, marginTop: '4px' }}>{t('about.tagline')}</div>
      </div>
      <div className="glass" style={{ borderRadius: '18px', padding: '6px 18px' }}>
        {rows.map((r, i) => (
          <div key={r[0]} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 0', borderBottom: i < rows.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
            <span style={{ color: C.muted, fontSize: '14px', fontWeight: 600 }}>{r[0]}</span>
            <span style={{ fontSize: '14px', fontWeight: 700, textTransform: r[0] === t('about.platform') ? 'capitalize' : 'none' }}>{r[1]}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '12.5px', color: C.dim, fontWeight: 600, lineHeight: 1.55, marginTop: '16px', textAlign: 'center' }}>{t('about.desc')}</div>
      <div style={{ flex: 1, minHeight: '20px' }} />
      <div style={{ textAlign: 'center', fontSize: '11.5px', color: C.dim, fontWeight: 600 }}>Un producto de Cosmos · v{APP_VERSION}</div>
    </div>
  );
}
