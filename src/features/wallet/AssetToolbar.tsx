import type { WalletStore } from '@/state/store';
import type { NetworkFilter } from '@/constants/home';
import type { NetworkId } from '@/constants/networks';
import type { NetworkSummary } from '@/lib/assetList';
import { fmt } from '@/lib/format';
import { NetworkSelect } from '@/ui/NetworkSelect';
import { SearchField } from '@/ui/SearchField';
import '@/styles/features/wallet/asset-toolbar.css';

/**
 * Home's asset tools, the way multi-network wallets lay them out: a search over the assets that
 * takes the whole row the network selector leaves, and the selector (ui/NetworkSelect) — every
 * network the wallet has an address on (lib/assetList.ts), the ones holding something first with
 * their value and how many assets, then the rest, saying whether nothing is there or the balance
 * could not be read.
 */
export function AssetToolbar({
  store,
  query,
  onQuery,
  filter,
  onFilter,
  summaries,
  total,
  networkName,
}: {
  store: WalletStore;
  query: string;
  onQuery: (q: string) => void;
  filter: NetworkFilter;
  onFilter: (f: NetworkFilter) => void;
  summaries: readonly NetworkSummary[];
  total: number;
  networkName: (n: NetworkId) => string;
}) {
  const t = store.t;
  const held = summaries.filter((s) => s.status === 'held').length;
  const sub = (s: NetworkSummary) =>
    s.status === 'held' ? (s.count === 1 ? t('home.netAssetsOne') : t('home.netAssets', { n: s.count })) : s.status === 'empty' ? t('home.netNone') : t('home.netUnknown');
  const money = (v: number | null) => (v === null ? '—' : '$' + fmt(v, 2));
  const current = filter === 'all' ? t('home.allNetworksLong') : networkName(filter);

  return (
    <div className="asset-toolbar">
      <SearchField
        value={query}
        onChange={onQuery}
        placeholder={t('home.searchAssets')}
        label={t('home.searchAssets')}
        clearLabel={t('common.clearSearch')}
        className="asset-search"
      />
      <NetworkSelect
        value={filter}
        onChange={onFilter}
        options={summaries.map((s) => ({
          id: s.id,
          name: networkName(s.id),
          sub: sub(s),
          value: s.status === 'held' ? money(s.value) : undefined,
          section: s.status === 'held' ? 'top' : 'rest',
        }))}
        all={{ name: t('home.allNetworksLong'), sub: held === 1 ? t('home.netWithAssetsOne') : t('home.netWithAssets', { n: held }), value: money(total) }}
        labels={{
          title: t('home.filterNetworks'),
          search: t('networks.search'),
          noMatch: t('networks.noMatch'),
          close: t('a11y.close'),
          clear: t('common.clearSearch'),
          top: t('home.netHeld'),
          rest: t('home.netOthers'),
          button: t('home.filterNetworksOn', { network: current }),
        }}
      />
    </div>
  );
}
