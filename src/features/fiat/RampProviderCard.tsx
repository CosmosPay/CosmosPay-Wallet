import { DEFAULT_RAMP_PROVIDER } from '@/constants/ramps';
import type { WalletStore } from '@/state/store';

/** Shows the route that will actually move money before KYC or a quote begins. */
export function RampProviderCard({ store }: { store: WalletStore }) {
  const provider = DEFAULT_RAMP_PROVIDER;
  const t = store.t;

  return (
    <section className="ramp-provider-card" aria-label={t('fiat.rampTitle')}>
      <div className="ramp-provider-top">
        <div className="ramp-provider-mark">↗</div>
        <div className="f1 min0">
          <div className="ramp-provider-eyebrow">{t('fiat.rampTitle')}</div>
          <div className="ramp-provider-name">{provider.name}</div>
        </div>
        <span className="ramp-provider-live"><i />{t('fiat.rampActive')}</span>
      </div>
      <div className="ramp-provider-route">
        <span>{t('fiat.rampBank')}</span><b>→</b><span>{provider.tokens.join(' / ')}</span><b>→</b><span>{t('fiat.rampWallet')}</span>
      </div>
      <div className="ramp-provider-meta">
        <span>{t('fiat.rampAnchor')}: <strong>{provider.anchor}</strong></span>
        <span>{provider.rails.join(' · ')}</span>
      </div>
      <p className="ramp-provider-note">{t('fiat.rampModular')}</p>
    </section>
  );
}
