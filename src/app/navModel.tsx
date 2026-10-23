/** Shared navigation model for BottomNav (phone/web), DesktopNav (the rail) and NavMenu
 *  (extension). Not exported beyond src/app — nothing outside these three uses it. */
import type { WalletStore } from '@/state/store';
import type { IconName } from '@/ui/Icon';

export type NavTab = 'home' | 'wallet' | 'earn' | 'markets' | 'profile' | 'more';

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
}

/**
 * The phone bar, in the Figma design's order: Home · Wallet · [QR] · Markets · More. The
 * centre slot is the raised scan button (`scan`), which is an action, not a tab — it opens
 * the scanner and never becomes the active item.
 */
export function navTabs(t: WalletStore['t']): NavItem[] {
  return [
    { key: 'home', label: t('tab.home'), icon: 'home' },
    { key: 'wallet', label: t('tab.wallet'), icon: 'wallet' },
    { key: 'scan', label: t('tab.scan'), icon: 'scan' },
    { key: 'markets', label: t('tab.markets'), icon: 'chart' },
    { key: 'more', label: t('tab.more'), icon: 'menu' },
  ];
}

/**
 * The rail: the same destinations, plus the ones the phone bar folds into "More" — a
 * vertical list has the room to name them, and on a desktop a menu behind a menu is one
 * click too many. A rail item for "More" would be a list pointing at a list, so there is
 * none; Settings stands in its place at the end.
 */
export function navTabsDesktop(t: WalletStore['t']): NavItem[] {
  return [
    { key: 'home', label: t('tab.home'), icon: 'home' },
    { key: 'wallet', label: t('tab.wallet'), icon: 'wallet' },
    { key: 'swap', label: t('home.swap'), icon: 'exchange' },
    { key: 'markets', label: t('tab.markets'), icon: 'chart' },
    { key: 'earn', label: t('tab.earn'), icon: 'earn' },
    { key: 'profile', label: t('tab.profile'), icon: 'user' },
    { key: 'settings', label: t('profile.settings'), icon: 'settings' },
  ];
}

/** The keys that open a SCREEN rather than switch a tab. */
const SCREEN_KEYS = new Set(['swap', 'scan', 'settings']);

export const navActiveKey = (store: WalletStore): string =>
  store.screen === 'swap' ? 'swap' : store.screen === 'settings' ? 'settings' : store.tab;

export const navGo = (store: WalletStore, key: string) =>
  SCREEN_KEYS.has(key)
    ? store.setScreen(key as 'swap' | 'scan' | 'settings')
    : store.go(key as NavTab, key as NavTab);
