import type { WalletStore } from '@/state/store';
import { navTabs, navActiveKey, navGo } from '@/app/navModel';
import { Icon } from '@/ui/Icon';
import { cx } from '@/lib/cx';
import '@/styles/app/bottom-nav.css';

/**
 * Phone/web bottom bar (the extension uses NavMenu instead), as the Figma design draws it:
 * a near-black bar of four labelled tabs with a short accent bar over the active one, and
 * the raised Cosmic Blue scan button in the middle slot.
 */
export function BottomNav({ store }: { store: WalletStore }) {
  const tabs = navTabs(store.t);
  const activeKey = navActiveKey(store);
  const idx = tabs.findIndex((x) => x.key === activeKey);

  return (
    <nav className="bottom-nav" aria-label={store.t('a11y.menu')}>
      <div className="bottom-nav-bar">
        {/* The accent bar slides between the tabs — one .is-tab-<i> rung per slot. */}
        <span className={cx('bottom-nav-indicator', idx >= 0 ? `is-tab-${idx}` : 'is-none')} />
        {tabs.map((tb) =>
          tb.key === 'scan' ? (
            <button
              key={tb.key}
              type="button"
              onClick={() => navGo(store, tb.key)}
              className="bottom-nav-tab bottom-nav-tab--fab"
              aria-label={tb.label}
            >
              <span className="bottom-nav-label is-fab">{tb.label}</span>
            </button>
          ) : (
            <button
              key={tb.key}
              type="button"
              onClick={() => navGo(store, tb.key)}
              className={cx('bottom-nav-tab', tb.key === activeKey && 'is-on')}
              aria-current={tb.key === activeKey ? 'page' : undefined}
            >
              <Icon name={tb.icon} size={22} className="bottom-nav-icon" />
              <span className="bottom-nav-label">{tb.label}</span>
            </button>
          ),
        )}
      </div>
      {/* The raised scan button sits over the bar's middle slot; its label is the slot's. */}
      {/* The design's own export: the blue disc, its shadow and the scan glyph in one file. */}
      <button type="button" onClick={() => navGo(store, 'scan')} className="bottom-nav-fab" aria-label={store.t('tab.scan')}>
        <img src={`${import.meta.env.BASE_URL}icons/ui/scan-fab.svg`} width="66" height="66" alt="" draggable={false} className="bottom-nav-fab-img" />
      </button>
    </nav>
  );
}
