import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, GhostButton, Logo } from '@/components/parts';
import { LangSelect } from '@/components/flags';
import { APP_VERSION } from '@/lib/config';

export function Welcome({ store }: { store: WalletStore }) {
  const t = store.t;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '2px 26px 32px', animation: 'fadeUp .3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: store.addingWallet ? 'space-between' : 'flex-end', minHeight: '34px', marginBottom: '2px' }}>
        {store.addingWallet && (
          <div onClick={() => store.cancelAddWallet()} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: C.muted, fontSize: '14px', fontWeight: 700, cursor: 'pointer', padding: '6px 4px' }}>
            <span style={{ fontSize: '20px' }}>‹</span> {t('common.cancel')}
          </div>
        )}
        <LangSelect value={store.lang} onChange={store.setLang} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ marginBottom: '24px' }}>
          <Logo size={104} />
        </div>
        <div style={{ fontSize: '34px', fontWeight: 800, letterSpacing: '-1.2px', marginBottom: '12px' }}>Cosmos Pay</div>
        <div style={{ fontSize: '13px', color: C.muted, fontWeight: 500, lineHeight: 1.5, maxWidth: '270px' }}>
          {t('welcome.subtitle')}
        </div>
      </div>
      <div className="col g12">
        <PrimaryButton onClick={() => store.startCreate()} style={{ padding: '18px' }}>
          {t('welcome.create')}
        </PrimaryButton>
        <GhostButton onClick={() => { store.setImportText(''); store.setScreen('import'); }}>
          {t('welcome.import')}
        </GhostButton>
        <div style={{ textAlign: 'center', fontSize: '11.5px', color: C.dim, fontWeight: 600, marginTop: '8px', letterSpacing: '.2px' }}>
          {t('welcome.producer')} · v{APP_VERSION}
        </div>
      </div>
    </div>
  );
}
