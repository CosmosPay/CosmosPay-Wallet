import type { WalletStore } from '@/components/store';
import { navTabs, navActiveKey, navGo } from './nav';
import '@/styles/components/bottom-nav.css';

/** Phone/web bottom tab bar (the extension navigates via NavMenu instead). */
export function BottomNav({ store }: { store: WalletStore }) {
  const tabs = navTabs(store.t);
  const activeKey = navActiveKey(store);
  const idx = Math.max(0, tabs.findIndex((x) => x.key === activeKey));
  const go = (key: string) => navGo(store, key);

  return (
    <div className="bottom-nav">
      {/* sliding active indicator — follows the selected tab */}
      <div
        className="bottom-nav-indicator"
        style={{
          width: `calc((100% - 32px) / ${tabs.length})`,
          transform: `translateX(${idx * 100}%)`,
        }}
      >
        <div className="bottom-nav-dot" />
      </div>

      {tabs.map((tb) => {
        const on = tb.key === activeKey;
        return (
          <div
            key={tb.key}
            onClick={() => go(tb.key)}
            className="tap bottom-nav-tab"
            style={{
              color: on ? 'var(--on-accent)' : 'var(--dim)',
              transform: on ? 'translateY(-10px)' : 'none',
            }}
          >
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none">{tb.icon}</svg>
            {!on && <span className="bottom-nav-label">{tb.label}</span>}
          </div>
        );
      })}
    </div>
  );
}
