/** Home's tabs and filters (`features/wallet/Home.tsx`). Data only. */
import type { NetworkId } from '@/constants/networks';

/** The tabs under the actions, in the Figma's order. */
export const HOME_TABS = ['assets', 'activity', 'performance', 'watchlist'] as const;
export type HomeTab = (typeof HOME_TABS)[number];

/** The holdings' network filter: all of them, or one network (`features/wallet/AssetToolbar.tsx`). */
export type NetworkFilter = 'all' | NetworkId;

/** How many operations the Activity tab lists before "all activity" opens History. */
export const HOME_ACTIVITY_ROWS = 15;

/** What the notifications bell lists: what happened to the account, never the commissions. */
export const NOTIFY_KINDS: ReadonlySet<string> = new Set(['received', 'sent', 'swap', 'create']);
/** How many of those the bell's panel lists before "all activity" opens History. */
export const NOTIFY_ROWS = 12;
/** Where the bell remembers, per wallet and network, the newest operation already seen. */
export const NOTIFY_SEEN_KEY = 'cosmos.notifySeen';

/**
 * After a flow that moved money, every balance is read again at once (past its cache), then again
 * after each of these delays: a ledger's public API and the explorers index a transaction a few
 * seconds after it lands, so the first read can still show the old balance.
 */
export const AFTER_OPERATION_REREAD_MS = [4_000, 15_000] as const;
