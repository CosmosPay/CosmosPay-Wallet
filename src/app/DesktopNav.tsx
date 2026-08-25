import type { WalletStore } from '@/state/store';
import { navTabsDesktop, navActiveKey, navGo } from '@/app/navModel';
import { APP_VERSION } from '@/constants/app';
import { Logo } from '@/ui/Logo';
import { cx } from '@/lib/cx';
import '@/styles/app/desktop-nav.css';

/**
 * The vertical navigation rail, shown beside the screen column past `--desk-min`.
 *
 * Rendered whenever there is a session, NOT only on the four tab screens the way
 * `BottomNav` is — and that difference is the whole reason it is a separate component
 * rather than the same one turned sideways. A bar that appears and disappears costs a
 * phone nothing, because it sits over the content; a 252px rail that came and went would
 * reflow the entire window every time the user opened Send. It stays, and the active item
 * follows `store.tab`, so navigating into a flow reads as "still inside Home".
 *
 * Below the breakpoint the whole thing is `display: none` (desktop-nav.css) rather than
 * unmounted: the switch between the two navigations is a pure media query, so there is no
 * resize listener anywhere and nothing to get out of step during hydration.
 */
export function DesktopNav({ store }: { store: WalletStore }) {
  const tabs = navTabsDesktop(store.t);
  const activeKey = navActiveKey(store);

  return (
    <nav className="shell-side">
      <div className="desk-brand">
        <Logo size={26} />
        <span className="desk-brand-name">Cosmos Pay</span>
      </div>

      <div className="desk-nav-list">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => navGo(store, tb.key)}
            className={cx('tap desk-nav-item', tb.key === activeKey && 'is-on')}
            aria-current={tb.key === activeKey ? 'page' : undefined}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              {tb.icon}
            </svg>
            <span className="desk-nav-label">{tb.label}</span>
          </button>
        ))}
      </div>

      <div className="desk-side-foot">v{APP_VERSION}</div>
    </nav>
  );
}
