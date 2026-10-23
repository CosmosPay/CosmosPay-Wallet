import type { WalletStore } from '@/state/store';
import { NavMenu } from '@/app/NavMenu';
import { Icon, type IconName } from '@/ui/Icon';
import { ageFromBirthdate } from '@/lib/greeting';
import { cx } from '@/lib/cx';
import type { Screen } from '@/lib/screens';
import '@/styles/features/wallet/more.css';

interface Tile {
  key: string;
  label: string;
  icon: IconName;
  go: () => void;
  /** One of the design's accents behind the glyph (.more-tile--<tone>). */
  tone: 'blue' | 'green' | 'amber' | 'violet' | 'slate';
}

/**
 * The bar's "More" tab: everything that is not one of its own tabs, grouped by what it is
 * for. On the phone this is where Earn, the fiat ramp, the developer tools and the settings
 * live; the desktop rail names the main ones directly.
 */
export function More({ store }: { store: WalletStore }) {
  const t = store.t;
  const to = (s: Screen) => () => store.setScreen(s);
  const fiatOk = (ageFromBirthdate(store.meta?.birthdate ?? '') ?? 0) >= 18;
  const fiatReady = Boolean(store.meta?.cosmosPayReceiverId);

  const sections: { title: string; tiles: Tile[] }[] = [
    {
      title: t('more.money'),
      tiles: [
        { key: 'swap', label: t('home.exchange'), icon: 'exchange', go: to('swap'), tone: 'blue' },
        { key: 'send', label: t('common.send'), icon: 'send', go: to('send'), tone: 'blue' },
        { key: 'receive', label: t('common.receive'), icon: 'receive', go: to('receive'), tone: 'green' },
        { key: 'paylink', label: t('paylink.title'), icon: 'link', go: to('paylink'), tone: 'violet' },
        ...(fiatOk
          ? [{ key: 'fiat', label: t('fiat.rampTitle'), icon: 'bank' as const, go: to(fiatReady ? 'deposit' : 'fiat'), tone: 'amber' as const }]
          : []),
        { key: 'history', label: t('history.title'), icon: 'history', go: to('history'), tone: 'slate' },
      ],
    },
    {
      title: t('more.grow'),
      tiles: [
        { key: 'earn', label: t('tab.earn'), icon: 'earn', go: () => store.go('earn', 'earn'), tone: 'green' },
        { key: 'liquidity', label: t('more.liquidity'), icon: 'liquidity', go: to('liquidity'), tone: 'blue' },
        { key: 'markets', label: t('tab.markets'), icon: 'chart', go: () => store.go('markets', 'markets'), tone: 'violet' },
      ],
    },
    {
      title: t('more.tools'),
      tiles: [
        { key: 'scan', label: t('scan.scanQr'), icon: 'scan', go: to('scan'), tone: 'blue' },
        { key: 'sign-tx', label: t('ops.signTx'), icon: 'key', go: to('sign-tx'), tone: 'violet' },
        { key: 'gateway-ops', label: t('ops.gatewayTitle'), icon: 'layers', go: to('gateway-ops'), tone: 'slate' },
        { key: 'add-asset', label: t('addAsset.title'), icon: 'plus', go: to('add-asset'), tone: 'green' },
        { key: 'add-network', label: t('net.add'), icon: 'network', go: to('add-network'), tone: 'amber' },
      ],
    },
    {
      title: t('more.account'),
      tiles: [
        { key: 'profile', label: t('tab.profile'), icon: 'user', go: () => store.go('profile', 'profile'), tone: 'blue' },
        { key: 'settings', label: t('profile.settings'), icon: 'settings', go: to('settings'), tone: 'slate' },
        { key: 'export', label: t('profile.exportKeys'), icon: 'shield', go: to('export'), tone: 'amber' },
        { key: 'about', label: t('profile.about'), icon: 'info', go: to('about'), tone: 'violet' },
      ],
    },
  ];

  let n = 0;
  return (
    <div className="scr screen pb-110">
      <div className="main-head">
        <span className="title-24">{t('tab.more')}</span>
        <NavMenu store={store} />
      </div>
      {sections.map((sec) => (
        <section key={sec.title} className="more-section">
          <h2 className="more-title">{sec.title}</h2>
          <div className="more-grid">
            {sec.tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                onClick={tile.go}
                className={cx('more-tile', `more-tile--${tile.tone}`, `stagger-${Math.min(n++, 11)}`)}
              >
                <span className="more-tile-icon">
                  <Icon name={tile.icon} size={20} />
                </span>
                <span className="more-tile-label">{tile.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
