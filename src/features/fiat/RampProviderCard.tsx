import { DEFAULT_RAMP_PROVIDER } from '@/constants/ramps';
import { APP_NAME } from '@/constants/app';
import { ArrowUpRightIcon } from '@/ui/Icons';
import type { WalletStore } from '@/state/store';

/**
 * Shows the route that will actually move money before KYC or a quote begins. It is named as
 * Cosmos Pay, never by the provider behind it: the copy does not name the services Cosmos Pay
 * is built on (constants/providerNames.ts). The provider's rails and tokens are still its own.
 */
export function RampProviderCard({ store }: { store: WalletStore }) {
  const provider = DEFAULT_RAMP_PROVIDER;
  const t = store.t;

  return (
    <section className="ramp-provider-card" aria-label={t('fiat.rampTitle')}>
      <div className="ramp-provider-top">
        <div className="ramp-provider-mark" aria-hidden="true">
          <ArrowUpRightIcon />
        </div>
        <div className="f1 min0">
          <div className="ramp-provider-eyebrow">{t('fiat.rampTitle')}</div>
          <div className="ramp-provider-name">{APP_NAME}</div>
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
