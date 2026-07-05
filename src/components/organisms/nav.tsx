/** Shared navigation model for BottomNav (phone/web) and NavMenu (extension).
 *  Deliberately NOT re-exported from the '@/components/parts' barrel — nothing
 *  outside these two components uses it. */
import type { ReactNode } from 'react';
import type { WalletStore } from '@/components/store';

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

export const navActiveKey = (store: WalletStore) => (store.screen === 'swap' ? 'swap' : store.tab);

export const navGo = (store: WalletStore, key: string) =>
  key === 'swap' ? store.setScreen('swap') : store.go(key as NavTab, key as NavTab);
