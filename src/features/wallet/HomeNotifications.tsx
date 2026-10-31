import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { HistoryRow } from '@/features/money/HistoryRow';
import { Dropdown } from '@/ui/Dropdown';
import { Sheet } from '@/ui/Sheet';
import { BellIcon, CloseIcon } from '@/ui/Icons';
import { cx } from '@/lib/cx';
import { inkHandlers } from '@/lib/ink';
import { isDesktopLayout } from '@/lib/layout';
import { isUnread, notificationsOf, readSeen, unreadCount, writeSeen } from '@/lib/notifications';
import '@/styles/features/wallet/home-header.css';

/**
 * The notifications bell beside the settings (the Figma's Home header): what happened to the
 * account — payments in and out, swaps, its creation — with a dot while something arrived
 * since the bell was last opened (lib/notifications.ts). Opening it lists them, the new ones
 * marked, each row opening its operation like the activity list's; the foot opens History.
 * A panel under the bell on a PC window, a sheet on a phone.
 */
export function HomeNotifications({ store }: { store: WalletStore }) {
  const t = store.t;
  const [open, setOpen] = useState<null | 'menu' | 'sheet'>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const items = useMemo(() => notificationsOf(store.history), [store.history]);
  const walletId = store.meta?.id ?? null;
  const networkId = store.network.id;

  // When this wallet last looked, on this network; and the same moment as it stood when the
  // panel opened, so what was new stays marked while it is open.
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [markedFrom, setMarkedFrom] = useState<string | null>(null);
  useEffect(() => {
    setSeenAt(null);
    if (!walletId) return;
    let live = true;
    void readSeen(walletId, networkId).then((at) => live && setSeenAt(at));
    return () => {
      live = false;
    };
  }, [walletId, networkId]);

  const unread = unreadCount(items, seenAt);
  const close = () => setOpen(null);
  const toggle = () => {
    if (open) return close();
    setMarkedFrom(seenAt);
    setOpen(isDesktopLayout() ? 'menu' : 'sheet');
    // Seen up to the newest listed — the ledger's clock, not the device's.
    const newest = items[0]?.createdAt;
    if (walletId && newest && unread > 0) {
      setSeenAt(newest);
      void writeSeen(walletId, networkId, newest);
    }
  };

  const list = (
    <div className="home-notif-body">
      {items.length > 0 ? (
        <div className="home-notif-list">
          {items.map((it, i) => (
            <div key={it.id} className={cx('home-notif', isUnread(it, markedFrom) && 'is-new')}>
              <HistoryRow item={it} store={store} index={i} dense />
            </div>
          ))}
        </div>
      ) : (
        <p className="home-notif-none">{t('notify.none')}</p>
      )}
      <button
        type="button"
        className="link-btn home-menu-link"
        onClick={() => {
          close();
          store.setScreen('history');
        }}
      >
        {t('home.allActivity')}
      </button>
    </div>
  );

  return (
    <div className="home-menu">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        aria-label={unread > 0 ? t('notify.openNew', { n: unread }) : t('notify.title')}
        onClick={toggle}
        className="home-icon-btn home-bell"
      >
        <BellIcon />
        {unread > 0 && <span className="home-bell-dot" aria-hidden="true" />}
      </button>
      <Dropdown open={open === 'menu'} onClose={close} anchorRef={trigger} label={t('notify.title')} className="home-menu-panel home-notif-panel">
        <p className="home-menu-title">{t('notify.title')}</p>
        {list}
      </Dropdown>
      <Sheet open={open === 'sheet'} onClose={close} labelledBy={titleId}>
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {t('notify.title')}
          </h2>
          <button type="button" className="sheet-close ink" aria-label={t('a11y.close')} onClick={close} {...inkHandlers}>
            <CloseIcon />
          </button>
        </div>
        {list}
      </Sheet>
    </div>
  );
}
