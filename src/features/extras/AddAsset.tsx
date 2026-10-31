import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { WalletStore } from '@/state/store';
import { NETWORKS, NETWORK_IDS, type NetworkId } from '@/constants/networks';
import { CheckIcon, PlusIcon } from '@/ui/Icons';
import { AssetLogo, NetworkLogo, assetMeta } from '@/ui/AssetLogo';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Field } from '@/ui/Field';
import { SearchField } from '@/ui/SearchField';
import { NetworkSelect } from '@/ui/NetworkSelect';
import { Switch } from '@/ui/Switch';
import { isValidPublicKey } from '@/lib/wallet';
import { resolveAssetIssuer } from '@/lib/stellar';
import { loadRegistry, type RegistryAsset } from '@/lib/assetRegistry';
import { buildCatalog, shortAsset, type CatalogEntry } from '@/lib/assetCatalog';
import { isTracked } from '@/lib/trackedTokens';
import { rowMatches } from '@/lib/assetList';
import { isHomeCoin } from '@/lib/logos';
import { COMMON_CODES, ASSET_CODE_MAX } from '@/constants/extras';
import { cx } from '@/lib/cx';
import '@/styles/features/extras/add-asset.css';

/* ---------------------------- ADD ASSET -----------------------------
 * Every network's assets, the way multi-network wallets offer them: a search and a network
 * selector over one list. What adding means depends on the network, and the row says it:
 *
 * - Stellar: a trustline, a transaction on the ledger — a button, and a decision about an
 *   ISSUER, not a ticker. Anyone may issue a token called `USDC` — mainnet carries twenty-odd
 *   accounts doing it — so the verified registry entries come first, with who issues them,
 *   and the rest are shown only on the Stellar network, BELOW a warning, with the manual form.
 * - Every other network: each one's coin and registry tokens are always read ("included"),
 *   and any other token NEAR Intents lists where it can be read (lib/assetCatalog.ts) is a
 *   switch: on, the wallet reads and lists its balance (lib/trackedTokens.ts). It never makes
 *   the token payable — sending stays the coin and the registry's contracts.
 */

/** A Stellar row: either a registry entry or one discovered from the user's Horizon. */
interface StellarRow {
  code: string;
  issuer: string;
  /** Empty for a discovered row — we do not know who runs it. */
  issuerName: string;
  issuerDomain: string;
  verified: boolean;
}

const toRow = (a: RegistryAsset): StellarRow => ({
  code: a.code,
  issuer: a.issuer ?? '',
  issuerName: a.issuerName,
  issuerDomain: a.issuerDomain,
  verified: a.verified,
});

export function AddAsset({ store }: { store: WalletStore }) {
  const t = store.t;
  const [net, setNet] = useState<'all' | NetworkId>('all');
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [issuer, setIssuer] = useState('');
  const [adding, setAdding] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [rows, setRows] = useState<StellarRow[]>([]);
  const [loading, setLoading] = useState(true);

  const issuerOk = isValidPublicKey(issuer.trim());
  const ok = code.trim().length >= 1 && code.trim().length <= ASSET_CODE_MAX && issuerOk && !store.busy;
  const held = new Set((store.account?.balances ?? []).map((b) => `${b.code}:${b.issuer ?? ''}`));
  const stellarName = store.networkName('stellar');

  // Every other network's tokens, as NEAR Intents lists them.
  const { loadIntentsAssets } = store;
  useEffect(() => {
    void loadIntentsAssets();
  }, [loadIntentsAssets]);
  const catalog = useMemo(() => buildCatalog(store.intentsAssets, store.chainNet), [store.intentsAssets, store.chainNet]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setRows([]);
    (async () => {
      // The registry first: the maintained list, or the bundled one offline.
      const registry = await loadRegistry(store.network.id);
      const known = registry.filter((a) => a.issuer).map(toRow);
      if (alive) setRows(known);

      // Then whatever the user's own Horizon knows about the remaining codes.
      // This is a POPULARITY ranking (`resolveAssetIssuer` sorts by trustlines),
      // never an identity check, so nothing it returns is marked verified — the
      // most-held issuer of a code and the legitimate one are not the same claim,
      // and conflating them is the exact mistake the registry exists to prevent.
      const seen = new Set(known.map((r) => r.code));
      const missing = COMMON_CODES.filter((c) => !seen.has(c));
      const found = await Promise.all(
        missing.map(async (c) => {
          const iss = await resolveAssetIssuer(store.network, c);
          return iss ? { code: c, issuer: iss, issuerName: '', issuerDomain: '', verified: false } : null;
        }),
      );
      if (alive) {
        setRows([...known, ...found.filter((r): r is StellarRow => !!r)]);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.network]);

  const stellarFields = (r: StellarRow) => [r.code, assetMeta(r.code).name, r.issuerName, r.issuerDomain, stellarName];
  const verified = rows.filter((r) => r.verified && rowMatches(query, stellarFields(r)));
  const unverified = rows.filter((r) => !r.verified && rowMatches(query, stellarFields(r)));
  const showStellar = net === 'all' || net === 'stellar';
  const others = catalog.filter(
    (e) => (net === 'all' || e.network === net) && rowMatches(query, [e.symbol, assetMeta(e.symbol).name, store.networkName(e.network), e.asset]),
  );

  const addPreset = async (c: string, iss: string) => {
    setAdding(`${c}:${iss}`);
    const done = await store.addAssetTrustline(c, iss);
    setAdding('');
    if (done) store.go('home', 'home');
  };
  const addManual = async () => {
    const done = await store.addAssetTrustline(code, issuer);
    if (done) store.go('home', 'home');
  };

  const stellarRow = (a: StellarRow) => {
    const key = `${a.code}:${a.issuer}`;
    return (
      <AssetRowShell key={key} code={a.code} network="stellar">
        <span className="add-asset-text">
          <span className="add-asset-sym">{a.code}</span>
          {/* Who issues it, then the address. The name is what a person can judge; the
              address is what they can verify. */}
          <span className="add-asset-sub">
            {stellarName} · {a.issuerName ? t('addAsset.issuedBy').replace('{name}', a.issuerName) : `${a.issuer.slice(0, 4)}…${a.issuer.slice(-4)}`}
            {a.issuerDomain ? ` · ${a.issuerDomain}` : ''}
          </span>
        </span>
        {held.has(key) ? (
          <span className="add-asset-state">
            <CheckIcon />
            {t('addAsset.held')}
          </span>
        ) : (
          <button type="button" onClick={() => addPreset(a.code, a.issuer)} disabled={store.busy} className={cx('add-asset-btn', store.busy && adding !== key && 'is-dim')}>
            {adding === key ? <Spinner size={15} tone="text" /> : t('addAsset.addShort')}
          </button>
        )}
      </AssetRowShell>
    );
  };

  const catalogRow = (e: CatalogEntry) => {
    const name = store.networkName(e.network);
    const on = e.kind !== 'addable' || isTracked(store.trackedTokens, e.network, e.asset);
    return (
      <AssetRowShell key={`${e.network}:${e.asset}`} code={e.symbol} network={e.network}>
        <span className="add-asset-text">
          <span className="add-asset-sym">{e.symbol}</span>
          <span className="add-asset-sub">
            {name} · {e.kind === 'native' ? t('addAsset.native') : shortAsset(e.asset)}
          </span>
        </span>
        {e.kind === 'addable' ? (
          <Switch
            on={on}
            label={t('addAsset.showToken', { symbol: e.symbol, network: name })}
            onChange={(next) =>
              void (next ? store.trackToken(e.network, { symbol: e.symbol, asset: e.asset, decimals: e.decimals }) : store.untrackToken(e.network, e.asset))
            }
          />
        ) : (
          <span className="add-asset-state is-quiet">{t('addAsset.included')}</span>
        )}
      </AssetRowShell>
    );
  };

  const counts = useMemo(() => {
    const by = new Map<NetworkId, number>();
    for (const e of catalog) by.set(e.network, (by.get(e.network) ?? 0) + 1);
    by.set('stellar', rows.length);
    return by;
  }, [catalog, rows.length]);
  const count = (n: number) => (n === 1 ? t('home.netAssetsOne') : t('home.netAssets', { n }));
  const currentName = net === 'all' ? t('home.allNetworksLong') : store.networkName(net);
  const nothing = (showStellar ? verified.length + (net === 'stellar' ? unverified.length : 0) : 0) + others.length === 0;

  return (
    <div className="scr screen pb-40">
      <ScreenHeader title={t('addAsset.title')} onBack={store.goBack} />
      <p className="add-asset-desc">{t('addAsset.descAll')}</p>

      <div className="add-asset-tools">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('home.searchAssets')}
          label={t('home.searchAssets')}
          clearLabel={t('common.clearSearch')}
          className="add-asset-search"
        />
        <NetworkSelect
          value={net}
          onChange={setNet}
          options={NETWORK_IDS.filter((id) => id === 'stellar' || counts.has(id)).map((id) => ({
            id,
            name: store.networkName(id),
            sub: count(counts.get(id) ?? 0),
            section: 'top' as const,
          }))}
          all={{ name: t('home.allNetworksLong'), sub: count(catalog.length + rows.length) }}
          labels={{
            title: t('home.filterNetworks'),
            search: t('networks.search'),
            noMatch: t('networks.noMatch'),
            close: t('a11y.close'),
            clear: t('common.clearSearch'),
            top: '',
            rest: '',
            button: t('home.filterNetworksOn', { network: currentName }),
          }}
        />
      </div>

      {showStellar && loading && verified.length === 0 && (
        <div className="add-asset-loading">
          <Spinner tone="text" /> {t('addAsset.loading')}
        </div>
      )}

      <div className="add-asset-list">
        {showStellar && verified.map(stellarRow)}
        {others.map(catalogRow)}
      </div>

      {/* The rest of Stellar's — a popularity ranking, not a check — only on Stellar, under a warning. */}
      {net === 'stellar' && unverified.length > 0 && (
        <>
          <h2 className="add-asset-label">{t('addAsset.unverified')}</h2>
          <p className="add-asset-warn">{t('addAsset.unverifiedWarn')}</p>
          <div className="add-asset-list">{unverified.map(stellarRow)}</div>
        </>
      )}

      {nothing && !loading && <p className="add-asset-none">{query.trim() ? t('home.noAssetMatch', { q: query.trim() }) : t('addAsset.none')}</p>}

      {net === 'stellar' &&
        (!showCustom ? (
          <GhostButton onClick={() => setShowCustom(true)}>
            <PlusIcon />
            {t('addAsset.custom')}
          </GhostButton>
        ) : (
          <>
            <h2 className="add-asset-label">{t('addAsset.manual')}</h2>
            <Field label={t('addAsset.code')} value={code} onChange={(v) => setCode(v.toUpperCase().slice(0, ASSET_CODE_MAX))} placeholder="USDC" />
            <label className="add-asset-issuer-field">
              <div className="field-label add-asset-issuer-label">{t('addAsset.issuer')}</div>
              <input value={issuer} onChange={(e) => setIssuer((e.target as HTMLInputElement).value.trim())} placeholder="G…" className="input add-asset-issuer-input" />
            </label>
            <div className={`add-asset-valid add-asset-valid--${!issuer ? 'none' : issuerOk ? 'ok' : 'bad'}`}>
              {!issuer ? null : issuerOk ? <CheckIcon className="add-asset-valid-icon" /> : t('addAsset.invalidIssuer')}
            </div>
            <div className="kb-dock">
              <PrimaryButton disabled={!ok} onClick={addManual}>
                {store.busy && !adding ? <Spinner /> : t('addAsset.add')}
              </PrimaryButton>
            </div>
          </>
        ))}
    </div>
  );
}

/** One asset: its logo with its network's mark on the corner, then what the row says and does. */
function AssetRowShell({ code, network, children }: { code: string; network: NetworkId; children: ReactNode }) {
  return (
    <div className="add-asset-row">
      <span className="add-asset-logo">
        <AssetLogo code={code} size={36} />
        {/* A coin on its home network needs no second mark: ETH on Ethereum is ETH. */}
        {!isHomeCoin(network, code) && (
          <span className="add-asset-net" aria-hidden="true">
            <NetworkLogo network={network} size={20} />
          </span>
        )}
      </span>
      {children}
    </div>
  );
}
