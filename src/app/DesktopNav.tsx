import type { WalletStore } from "@/state/store";
import { navTabsDesktop, navActiveKey, navGo, navShortcuts, navOpenShortcut } from "@/app/navModel";
import { APP_VERSION } from "@/constants/app";
import { AccountIcon, CosmosMark, PowerIcon } from "@/ui/Icons";
import { cx } from "@/lib/cx";
import "@/styles/app/desktop-nav.css";

/**
 * The vertical navigation rail, shown beside the screen column past `--desk-min`.
 *
 * Rendered whenever there is a session, NOT only on the four tab screens the way
 * `BottomNav` is — and that difference is the whole reason it is a separate component
 * rather than the same one turned sideways. A bar that appears and disappears costs a
 * phone nothing, because it sits over the content; a 252px rail that came and went would
 * reflow the entire window every time the user opened Send. It stays, and the active item
 * follows the exact shortcut when available, otherwise the parent tab.
 *
 * Below the breakpoint the whole thing is `display: none` (desktop-nav.css) rather than
 * unmounted: the switch between the two navigations is a pure media query, so there is no
 * resize listener anywhere and nothing to get out of step during hydration.
 */
export function DesktopNav({ store }: { store: WalletStore }) {
  const available = navTabsDesktop(store.t);
  const tabs = [
    ...available.filter((tab) => tab.key !== "scan" && tab.key !== "profile"),
    ...available.filter((tab) => tab.key === "scan"),
  ];
  const shortcuts = navShortcuts(store);
  const activeKey = shortcuts.some((item) => item.key === store.screen) ? store.screen : navActiveKey(store);

  return (
    <nav className="shell-side" aria-label={store.t("nav.label")}>
      {/* The logo goes home — the wallet's Home, inside the session; never a page load,
          which would leave the app (and, before the session was kept, end it). */}
      <button
        type="button"
        className="desk-brand"
        onClick={() => navGo(store, "home")}
        aria-label={store.t("error.goHome")}
      >
        <CosmosMark className="desk-brand-mark" />
        <span className="desk-brand-name">Cosmos Wallet</span>
      </button>

      <ul className="desk-nav-list">
        {tabs.map((tb) => (
          <li
            key={tb.key}
            className={cx(
              "desk-nav-entry",
              tb.key === "scan" && "is-tool",
            )}
          >
            <button
              type="button"
              onClick={() => navGo(store, tb.key)}
              className={cx("desk-nav-item", tb.key === activeKey && "is-on")}
              aria-current={tb.key === activeKey ? "page" : undefined}
            >
              {tb.icon}
              <span className="desk-nav-copy">
                <span className="desk-nav-label">
                  {tb.key === "scan" ? store.t("scan.title") : tb.label}
                </span>
              </span>
            </button>
          </li>
        ))}
        {shortcuts.map((item, index) => (
          <li key={item.key} className={cx("desk-nav-entry", index === 0 && "is-tool")}>
            <button
              type="button"
              onClick={() => navOpenShortcut(store, item.key)}
              className={cx("desk-nav-item", item.key === activeKey && "is-on")}
              aria-current={item.key === activeKey ? "page" : undefined}
            >
              {item.icon}
              <span className="desk-nav-label">{item.label}</span>
            </button>
          </li>
        ))}
        <li className="desk-nav-entry is-account">
          <button type="button" onClick={() => navGo(store, "profile")}
            className={cx("desk-nav-item", activeKey === "profile" && "is-on")}
            aria-current={activeKey === "profile" ? "page" : undefined}>
            <AccountIcon />
            <span className="desk-nav-copy">
              <span className="desk-nav-label">{store.t("profile.title")}</span>
              {store.meta?.name && <span className="desk-nav-detail">{store.meta.name}</span>}
            </span>
          </button>
        </li>
        <li className="desk-nav-entry">
          <button type="button" className="desk-nav-item" onClick={() => store.lock()}>
            <PowerIcon /><span>{store.t("profile.lock")}</span>
          </button>
        </li>
      </ul>

      <div className="desk-side-foot">v{APP_VERSION}</div>
    </nav>
  );
}
