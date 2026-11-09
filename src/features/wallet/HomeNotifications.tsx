import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { NotificationRow } from '@/features/wallet/NotificationRow';
import { Dropdown } from '@/ui/Dropdown';
import { Tabs } from '@/ui/Tabs';
import { Sheet } from '@/ui/Sheet';
import { BellIcon, ChevronRightIcon, CloseIcon } from '@/ui/Icons';
import { groupByDay, relativeDay } from '@/lib/activity';
import { cx } from '@/lib/cx';
import { isDesktopLayout } from '@/lib/layout';
import { isUnread, notificationsOf, readSeen, unreadCount, writeSeen } from '@/lib/notifications';
import '@/styles/features/wallet/home-header.css';
import '@/styles/features/wallet/home-notifications.css';

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
  const panelId = useId();
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all');
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
    setFilter('all');
    setOpen(isDesktopLayout() ? 'menu' : 'sheet');
    // Seen up to the newest listed — the ledger's clock, not the device's.
    const newest = items[0]?.createdAt;
    if (walletId && newest && unread > 0) {
      setSeenAt(newest);
      void writeSeen(walletId, networkId, newest);
    }
  };

  const filtered = items.filter((item) => filter === 'all' || (filter === 'unread' ? isUnread(item, markedFrom) : !isUnread(item, markedFrom)));
  const list = (
    <div className="home-notif-body">
      <Tabs tabs={[{ key: 'all', label: t('notify.all') }, { key: 'unread', label: t('notify.unread') }, { key: 'read', label: t('notify.read') }]} value={filter} onChange={setFilter} label={t('notify.title')} panelId={panelId} className="home-notif-tabs" />
      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${filter}`} tabIndex={0}>
      {filtered.length > 0 ? (
        <div className="home-notif-list">
          {groupByDay(filtered).map((group) => {
            const relative = relativeDay(group.day, new Date());
            const [year, month, day] = group.day.split('-').map(Number);
            const dayLabel = relative ? t(`history.${relative}`) : new Date(year, month - 1, day).toLocaleDateString(store.locale, { day: 'numeric', month: 'short' });
            return (
              <section key={group.day} aria-label={dayLabel} className="home-notif-day">
                <h3 className="home-notif-date">{dayLabel}</h3>
                {group.items.map((item) => (
                  <div key={item.id} className={cx('home-notif', isUnread(item, markedFrom) && 'is-new')}>
                    {isUnread(item, markedFrom) && <span className="sr-only">{t('notify.unread')}</span>}
                    <NotificationRow item={item} store={store} />
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="home-notif-none">{t(!items.length ? 'notify.none' : filter === 'unread' ? 'notify.caughtUp' : 'notify.noRead')}</p>
      )}
      </div>
      <button
        type="button"
        className="home-notif-footer"
        onClick={() => {
          close();
          store.setScreen('history');
        }}
      >
        {t('home.allActivity')}<ChevronRightIcon />
      </button>
    </div>
  );

  return (
    <div className="home-menu home-notifications">
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
        {unread > 0 && <span className="home-bell-dot" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <Dropdown open={open === 'menu'} onClose={close} anchorRef={trigger} label={t('notify.title')} className="home-menu-panel home-notif-panel">
        <div className="home-notif-heading">
          <h2>{t('notify.title')}</h2>
          <button type="button" className="home-notif-close" aria-label={t('a11y.close')} onClick={close}><CloseIcon /></button>
        </div>
        {list}
      </Dropdown>
      <Sheet open={open === 'sheet'} onClose={close} labelledBy={titleId}>
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {t('notify.title')}
          </h2>
          <button type="button" className="sheet-close ink" aria-label={t('a11y.close')} onClick={close}>
            <CloseIcon />
          </button>
        </div>
        {list}
      </Sheet>
    </div>
  );
}

