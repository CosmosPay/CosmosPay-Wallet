/** Shared navigation model for BottomNav (phone/web), DesktopNav (the rail) and NavMenu
 *  (extension). Not exported beyond src/app — nothing outside these components uses it. */
import type { ReactNode } from 'react';
import type { WalletStore } from '@/state/store';
import { TAB_SCREEN, isScreenOn, type Screen, type Tab } from '@/lib/screens';
import { ActivityIcon, EarnIcon, GearIcon, HomeIcon, InfoCircleIcon, KeyIcon, LinkIcon, MenuIcon, QrIcon, ScanIcon, WalletIcon } from '@/ui/Icons';

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

/** Account shortcuts shared by the desktop rail and the extension drawer. */
export function navShortcuts(store: Pick<WalletStore, 't' | 'meta'>): { key: Screen; label: string; icon: ReactNode }[] {
  return [
    { key: 'history', label: store.t('history.title'), icon: <ActivityIcon /> },
    { key: 'receive', label: store.t('profile.receiveAddr'), icon: <QrIcon /> },
    ...(store.meta?.email ? [{ key: 'cosmospay' as const, label: store.t('cosmospay.manage'), icon: <LinkIcon /> }] : []),
    { key: 'export', label: store.t('profile.exportKeys'), icon: <KeyIcon /> },
    { key: 'settings', label: store.t('profile.settings'), icon: <GearIcon /> },
    { key: 'about', label: store.t('profile.about'), icon: <InfoCircleIcon /> },
  ];
}

export function navOpenShortcut(store: WalletStore, screen: Screen) {
  if (screen === 'receive') store.setReceiveNet('stellar');
  store.setScreen(screen);
}

export const navActiveKey = (store: WalletStore): NavKey => (store.screen === 'scan' ? 'scan' : store.tab);

export const navGo = (store: WalletStore, key: NavKey) =>
  key === 'scan' ? store.setScreen('scan') : store.go(TAB_SCREEN[key], key);
