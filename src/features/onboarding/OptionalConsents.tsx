import type { WalletStore } from '@/state/store';
import { CheckRow } from '@/features/onboarding/CheckRow';
import '@/styles/features/onboarding/atoms.css';

/**
 * The two optional consents every new wallet is asked for: diagnostics and promotional
 * email. Both default OFF and neither ever blocks the flow.
 *
 * Shared rather than written twice, because the two onboarding paths that ask are the
 * same question and were drifting apart before this existed: the seed path asks on
 * `profile-setup`, and the sign-in path — which skips that screen entirely — once asked
 * nowhere at all, so its wallets were created with `metricsOptIn` absent: the same as
 * declining, except the user was never given the choice.
 *
 * `metricsOptIn` is not a preference the app can infer: it is what turns diagnostics on
 * (`lib/telemetry.ts`), and STORE_LISTING.md tells the Chrome Web Store it is optional
 * and off by default. Asking is the only way that stays true.
 */
export function OptionalConsents({ store }: { store: WalletStore }) {
  const t = store.t;
  return (
    <>
      <CheckRow
        on={store.draftMetricsOptIn}
        onToggle={() => store.setDraftMetricsOptIn(!store.draftMetricsOptIn)}
        className="ob-consent-metrics"
      >
        {t('setup.metricsOptIn')}
      </CheckRow>
      <CheckRow
        on={store.draftPromoOptIn}
        onToggle={() => store.setDraftPromoOptIn(!store.draftPromoOptIn)}
        className="ob-consent-promo"
      >
        {t('setup.promoOptIn')}
      </CheckRow>
    </>
  );
}
