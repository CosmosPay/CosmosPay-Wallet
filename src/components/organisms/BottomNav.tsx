import type { WalletStore } from '@/components/store';
import { navTabs, navActiveKey, navGo } from './nav';
import { cx } from '@/lib/cx';
import '@/styles/components/bottom-nav.css';

/** Phone/web bottom tab bar (the extension navigates via NavMenu instead). */
export function BottomNav({ store }: { store: WalletStore }) {
  const tabs = navTabs(store.t);
  const activeKey = navActiveKey(store);
  const idx = Math.max(0, tabs.findIndex((x) => x.key === activeKey));

  return (
    <div className="bottom-nav">
      {/* Sliding active indicator — one .is-tab-<i> rung per tab (bottom-nav.css
          hard-codes the five-tab width, matching navTabs). */}
      <div className={`bottom-nav-indicator is-tab-${idx}`}>
        <div className="bottom-nav-dot" />
      </div>

      {tabs.map((tb) => {
        const on = tb.key === activeKey;
        return (
          <div
            key={tb.key}
            onClick={() => navGo(store, tb.key)}
            className={cx('tap bottom-nav-tab', on && 'is-on')}
          >
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none">{tb.icon}</svg>
            {!on && <span className="bottom-nav-label">{tb.label}</span>}
          </div>
        );
      })}
    </div>
  );
}
