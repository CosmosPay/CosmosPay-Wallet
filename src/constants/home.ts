/** Home's tabs and filters (`features/wallet/Home.tsx`). Data only. */
import type { NetworkId } from '@/constants/networks';

/** The tabs under the actions, in the Figma's order. */
export const HOME_TABS = ['assets', 'activity', 'performance', 'watchlist'] as const;
export type HomeTab = (typeof HOME_TABS)[number];

/**
 * The holdings' network filter: all of them, or one network. These are always offered once the
 * wallet's addresses are derived; any other network joins the row while the wallet holds
 * something there (`features/wallet/Home.tsx`).
 */
export const NETWORK_FILTERS = ['all', 'stellar', 'solana', 'monad'] as const;
export type NetworkFilter = 'all' | NetworkId;

/** How many operations the Activity tab lists before "all activity" opens History. */
export const HOME_ACTIVITY_ROWS = 15;
