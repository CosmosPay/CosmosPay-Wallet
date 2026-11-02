import type { WalletStore } from '@/state/store';
import { navTabs, navActiveKey, navGo } from '@/app/navModel';
import { ActivityIcon } from '@/ui/Icons';
import { cx } from '@/lib/cx';
import '@/styles/app/bottom-nav.css';

/**
 * Phone/web bottom bar (the extension navigates via NavMenu instead), as the Figma draws it:
 * five places with their names, the scanner raised in the centre on the brand blue, and a line
 * over the place you are on.
 */
export function BottomNav({ store }: { store: WalletStore }) {
  const tabs = navTabs(store.t).flatMap((tab) =>
    tab.key === 'scan'
      ? [tab, { key: 'history' as const, label: store.t('history.title'), icon: <ActivityIcon /> }]
      : [tab],
  );
  const activeKey = navActiveKey(store);

  return (
    <nav className="bottom-nav" aria-label={store.t('nav.label')}>
      {tabs.map((tb) => {
        const on = store.screen === 'history' ? tb.key === 'history' : tb.key === activeKey;
        if (tb.key === 'scan') {
          return (
            <button key={tb.key} type="button" onClick={() => navGo(store, tb.key)} className="bottom-nav-scan">
              <span className="bottom-nav-scan-disc">{tb.icon}</span>
              <span className="bottom-nav-label">{tb.label}</span>
            </button>
          );
        }
        return (
          <button
            key={tb.key}
            type="button"
            onClick={() => tb.key === 'history' ? store.setScreen('history') : navGo(store, tb.key)}
            aria-current={on ? 'page' : undefined}
            className={cx('bottom-nav-tab', on && 'is-on')}
          >
            {tb.icon}
            <span className="bottom-nav-label">{tb.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
