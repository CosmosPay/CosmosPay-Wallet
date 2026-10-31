/** Shared navigation model for BottomNav (phone/web), DesktopNav (the rail) and NavMenu
 *  (extension). Not exported beyond src/app — nothing outside these components uses it. */
import type { ReactNode } from 'react';
import type { WalletStore } from '@/state/store';
import { TAB_SCREEN, isScreenOn, type Tab } from '@/lib/screens';
import { EarnIcon, HomeIcon, MenuIcon, ScanIcon, WalletIcon } from '@/ui/Icons';

/** A destination of the bar: a tab, or the scanner in its centre. */
export type NavKey = Tab | 'scan';

/**
 * The bar of the Figma design ("Cosmos Wallet", Home): Home, Wallet, the QR scanner raised in
 * the centre in the brand blue, Earn, More. Markets is a tab of Home (its Watchlist) and
 * reached from there, not a destination of its own. A switched-off section's tab is left out
 * (constants/features.ts).
 */
export function navTabs(t: WalletStore['t']): { key: NavKey; label: string; icon: ReactNode }[] {
  const tabs: { key: NavKey; label: string; icon: ReactNode }[] = [
    { key: 'home', label: t('tab.home'), icon: <HomeIcon /> },
    { key: 'wallet', label: t('tab.wallet'), icon: <WalletIcon /> },
    { key: 'scan', label: t('tab.scan'), icon: <ScanIcon /> },
    { key: 'earn', label: t('tab.earn'), icon: <EarnIcon /> },
    { key: 'profile', label: t('tab.more'), icon: <MenuIcon /> },
  ];
  return tabs.filter((tb) => tb.key === 'scan' || isScreenOn(TAB_SCREEN[tb.key]));
}

/** The same destinations for a vertical rail: the scanner is an item like the rest. */
export const navTabsDesktop = navTabs;

export const navActiveKey = (store: WalletStore): NavKey => (store.screen === 'scan' ? 'scan' : store.tab);

export const navGo = (store: WalletStore, key: NavKey) =>
  key === 'scan' ? store.setScreen('scan') : store.go(TAB_SCREEN[key], key);
