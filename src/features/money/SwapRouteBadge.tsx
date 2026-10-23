import type { WalletStore } from '@/state/store';
import { Icon, type IconName } from '@/ui/Icon';
import { Spinner } from '@/ui/Spinner';
import type { SwapRoute } from '@/lib/swapRoute';
import { cx } from '@/lib/cx';

const ROUTE_ICON: Record<SwapRoute, IconName> = {
  'stellar-dex': 'layers',
  jupiter: 'zap',
  kuru: 'flame',
  intents: 'sparkles',
};

/**
 * Says which venue will settle the swap on screen — the Stellar DEX, Jupiter, Kuru Flow or
 * NEAR Intents — and that a fresh quote is on its way. The route is what decides who builds
 * the transaction and what the wallet checks before signing it, so it is named, not hidden.
 */
export function SwapRouteBadge({ store, route, quoting }: { store: WalletStore; route: SwapRoute; quoting: boolean }) {
  const t = store.t;
  return (
    <div className={cx('swap-route', `is-${route}`)}>
      <span className="swap-route-icon">
        <Icon name={ROUTE_ICON[route]} size={14} />
      </span>
      <span className="swap-route-label">{t('swap.route', { venue: t(`swap.venue.${route}`) })}</span>
      {quoting && (
        <span className="swap-route-quoting">
          <Spinner size={15} tone="dim" /> {t('swap.quoting')}
        </span>
      )}
    </div>
  );
}
