import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { AssetLogo } from '@/ui/AssetLogo';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { Field } from '@/ui/Field';
import { isValidPublicKey } from '@/lib/wallet';
import { resolveAssetIssuer } from '@/lib/stellar';
import { loadRegistry, type RegistryAsset } from '@/lib/assetRegistry';
import { COMMON_CODES, ASSET_CODE_MAX } from '@/constants/extras';
import '@/styles/features/extras/add-asset.css';
import { cx } from '@/lib/cx';

/* ---------------------------- ADD ASSET -----------------------------
 * Two lists, and the split is the whole point of the screen.
 *
 * A trustline is a decision about an ISSUER, not about a ticker. Anyone may
 * issue a token called `USDC` — mainnet carries twenty-odd accounts doing it,
 * and eight more issue `USDT0` — so a single flat list of codes is a list in
 * which the real asset and the scam are the same row. Verified entries come from
 * the platform registry, where we checked the issuing account against the
 * organization named; everything else is shown BELOW a warning, because hiding
 * it would only push the user into the manual issuer field, where they would
 * have less information rather than more.
 */

/** A row: either a registry entry or one discovered from the user's Horizon. */
interface Row {
  code: string;
  issuer: string;
  /** Empty for a discovered row — we do not know who runs it. */
  issuerName: string;
  issuerDomain: string;
  verified: boolean;
  /** The issuer can freeze or claw back. Worth saying before the trustline. */
  restricted: boolean;
}

const toRow = (a: RegistryAsset): Row => ({
  code: a.code,
  issuer: a.issuer ?? '',
  issuerName: a.issuerName,
  issuerDomain: a.issuerDomain,
  verified: a.verified,
  restricted: a.flags.authRevocable || a.flags.clawback,
});

export function AddAsset({ store }: { store: WalletStore }) {
  const t = store.t;
  const [code, setCode] = useState('');
  const [issuer, setIssuer] = useState('');
  const [adding, setAdding] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const issuerOk = isValidPublicKey(issuer.trim());
  const ok = code.trim().length >= 1 && code.trim().length <= ASSET_CODE_MAX && issuerOk && !store.busy;
  const held = new Set((store.account?.balances ?? []).map((b) => `${b.code}:${b.issuer ?? ''}`));

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
          return iss ? { code: c, issuer: iss, issuerName: '', issuerDomain: '', verified: false, restricted: false } : null;
        }),
      );
      if (alive) {
        setRows([...known, ...found.filter((r): r is Row => !!r)]);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.network]);

  const verified = rows.filter((r) => r.verified);
  const unverified = rows.filter((r) => !r.verified);

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

  const list = (items: Row[]) => (
    <div className="glass add-asset-list">
      {items.map((a) => {
        const key = `${a.code}:${a.issuer}`;
        const isHeld = held.has(key);
        return (
          <div key={key} className="row g12 add-asset-row">
            <AssetLogo code={a.code} size={34} />
            <div className="f1 min0">
              <div className="add-asset-code">{a.code}</div>
              {/* Who issues it, then the address. The name is what a person can
                  judge; the address is what they can verify. Showing only the
                  address — as this screen used to — asks the user to compare 56
                  characters against a source they do not have. */}
              {a.issuerName ? (
                <div className="add-asset-by">
                  {t('addAsset.issuedBy').replace('{name}', a.issuerName)}
                  {a.issuerDomain ? ` · ${a.issuerDomain}` : ''}
                </div>
              ) : null}
              <div className="add-asset-issuer">{a.issuer.slice(0, 4)}…{a.issuer.slice(-4)}</div>
              {a.restricted ? <div className="add-asset-flag">{t('addAsset.clawbackWarn')}</div> : null}
            </div>
            {isHeld ? (
              <span className="add-asset-held">✓ {t('addAsset.held')}</span>
            ) : (
              <button
                onClick={() => addPreset(a.code, a.issuer)}
                disabled={store.busy}
                title={t('addAsset.add')}
                className={cx('glass-soft center shrink0 add-asset-plus', store.busy && adding !== key && 'is-dim')}
              >
                {adding === key ? <Spinner tone="text" /> : '+'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="scr screen pb-40">
      <BackBar title={t('addAsset.title')} onBack={store.goBack} />
      <div className="add-asset-desc">
        {t('addAsset.desc')}
      </div>

      {loading ? (
        <div className="glass center g10 add-asset-loading">
          <Spinner tone="text" /> {t('addAsset.loading')}
        </div>
      ) : (
        <>
          {verified.length > 0 && (
            <>
              <div className="label-up add-asset-label">{t('addAsset.verified')}</div>
              {list(verified)}
            </>
          )}

          {unverified.length > 0 && (
            <>
              <div className="label-up add-asset-label">{t('addAsset.unverified')}</div>
              <div className="glass add-asset-warn">{t('addAsset.unverifiedWarn')}</div>
              {list(unverified)}
            </>
          )}

          {verified.length === 0 && unverified.length === 0 && (
            <div className="glass add-asset-none">{t('addAsset.none')}</div>
          )}
        </>
      )}

      {!showCustom ? (
        <button onClick={() => setShowCustom(true)} className="glass-soft center g8 add-asset-custom-btn">
          ＋ {t('addAsset.custom')}
        </button>
      ) : (
        <>
          <div className="label-up add-asset-label">{t('addAsset.manual')}</div>
          <Field label={t('addAsset.code')} value={code} onChange={(v) => setCode(v.toUpperCase().slice(0, ASSET_CODE_MAX))} placeholder="USDC" />
          <label className="add-asset-issuer-field">
            <div className="label-up add-asset-issuer-label">{t('addAsset.issuer')}</div>
            <input value={issuer} onChange={(e) => setIssuer((e.target as HTMLInputElement).value.trim())} placeholder="G…" className="input add-asset-issuer-input" />
          </label>
          <div className={`add-asset-valid add-asset-valid--${!issuer ? 'none' : issuerOk ? 'ok' : 'bad'}`}>
            {!issuer ? '·' : issuerOk ? '✓' : t('addAsset.invalidIssuer')}
          </div>
          <div className="kb-dock">
            <PrimaryButton disabled={!ok} onClick={addManual}>{store.busy && !adding ? <Spinner /> : t('addAsset.add')}</PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}
