/** Shared navigation model for BottomNav (phone/web) and NavMenu (extension).
 *  Not exported beyond src/app — nothing outside these two components uses it. */
import type { ReactNode } from 'react';
import type { WalletStore } from '@/state/store';

export type NavTab = 'home' | 'earn' | 'markets' | 'profile';

/** Main navigation destinations — shared by BottomNav (phone/web) and NavMenuButton (extension). */
export function navTabs(t: WalletStore['t']): { key: string; label: string; icon: ReactNode }[] {
  // Home sits in the centre so the active indicator rests in the middle by default.
  return [
    {
      key: 'earn',
      label: t('tab.earn'),
      icon: (
        <>
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.9" />
          <path d="M9 14.5l6-6M9.5 9.5h.01M14.5 14.5h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </>
      ),
    },
    {
      key: 'markets',
      label: t('tab.markets'),
      icon: <path d="M4 16l4-5 4 3 4-7 4 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />,
    },
    {
      key: 'home',
      label: t('tab.home'),
      icon: <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />,
    },
    {
      key: 'swap',
      label: t('home.swap'),
      icon: <path d="M7 7h11l-3-3M17 17H6l3 3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />,
    },
    {
      key: 'profile',
      label: t('tab.profile'),
      icon: (
        <>
          <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.9" />
          <path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </>
      ),
    },
  ];
}

/**
 * The same destinations, ordered for a vertical rail.
 *
 * `navTabs` puts Home in the MIDDLE because the bottom bar's sliding indicator has to rest
 * somewhere by default and the centre is the only position that does not read as a bias. A
 * vertical list has no indicator to rest and no centre to rest it in — it has a first item,
 * and a list whose first item is "Ganar" reads as though earning were the main screen.
 *
 * Derived from `navTabs` rather than being a second table: the labels, the icons and the
 * keys all still have exactly one definition, and an id added there without a place here
 * simply falls off the rail instead of rendering twice.
 */
const DESKTOP_ORDER = ['home', 'earn', 'markets', 'swap', 'profile'];

export function navTabsDesktop(t: WalletStore['t']): { key: string; label: string; icon: ReactNode }[] {
  const byKey = new Map(navTabs(t).map((tab) => [tab.key, tab]));
  return DESKTOP_ORDER.map((key) => byKey.get(key)).filter((tab) => tab !== undefined);
}

export const navActiveKey = (store: WalletStore) => (store.screen === 'swap' ? 'swap' : store.tab);

export const navGo = (store: WalletStore, key: string) =>
  key === 'swap' ? store.setScreen('swap') : store.go(key as NavTab, key as NavTab);
