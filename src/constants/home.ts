/** Home's tabs and filters (`features/wallet/Home.tsx`). Data only. */

/** The tabs under the actions, in the Figma's order. */
export const HOME_TABS = ['assets', 'activity', 'performance', 'watchlist'] as const;
export type HomeTab = (typeof HOME_TABS)[number];

/** The holdings' network filter: all of them, or one network. */
export const NETWORK_FILTERS = ['all', 'stellar', 'solana', 'monad'] as const;
export type NetworkFilter = (typeof NETWORK_FILTERS)[number];

/** How many operations the Activity tab lists before "all activity" opens History. */
export const HOME_ACTIVITY_ROWS = 15;
