import { useEffect, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar, Spinner, AssetLogo } from '@/components/parts';
import { Field } from '@/components/screens/Onboarding';
import { isValidPublicKey } from '@/lib/wallet';
import { resolveAssetIssuer } from '@/lib/stellar';
import { KNOWN_ISSUERS, COMMON_CODES, ASSET_CODE_MAX } from '@/constants/extras';
import '@/styles/screens/extras/add-asset.css';

/* ---------------------------- ADD ASSET ----------------------------- */
export function AddAsset({ store }: { store: WalletStore }) {
  const t = store.t;
  const [code, setCode] = useState('');
  const [issuer, setIssuer] = useState('');
  const [adding, setAdding] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  const issuerOk = isValidPublicKey(issuer.trim());
  const ok = code.trim().length >= 1 && code.trim().length <= ASSET_CODE_MAX && issuerOk && !store.busy;
  const held = new Set((store.account?.balances ?? []).map((b) => `${b.code}:${b.issuer ?? ''}`));
  const netKey = store.network.id === 'public' ? 'public' : store.network.id === 'testnet' ? 'testnet' : '';

  // Resolve the issuer for each common code on the active network.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setResolved({});
    (async () => {
      const entries = await Promise.all(
        COMMON_CODES.map(async (c) => {
          const known = netKey ? KNOWN_ISSUERS[c]?.[netKey as 'public' | 'testnet'] : undefined;
          const iss = known ?? (await resolveAssetIssuer(store.network, c));
          return [c, iss] as const;
        }),
      );
      if (alive) {
        setResolved(Object.fromEntries(entries));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.network]);

  const common = COMMON_CODES.map((c) => ({ code: c, issuer: resolved[c] })).filter((a) => !!a.issuer) as {
    code: string;
    issuer: string;
  }[];

  const addPreset = async (c: string, iss: string) => {
    setAdding(c);
    const done = await store.addAssetTrustline(c, iss);
    setAdding('');
    if (done) store.go('home', 'home');
  };
  const addManual = async () => {
    const done = await store.addAssetTrustline(code, issuer);
    if (done) store.go('home', 'home');
  };

  return (
    <div className="scr screen pb-40">
      <BackBar title={t('addAsset.title')} onBack={() => store.go('home', 'home')} />
      <div className="add-asset-desc">
        {t('addAsset.desc')}
      </div>

      <div className="label-up add-asset-label">{t('addAsset.common')}</div>

      {loading ? (
        <div className="glass center g10 add-asset-loading">
          <Spinner color="var(--text)" /> {t('addAsset.loading')}
        </div>
      ) : common.length ? (
        <div className="glass add-asset-list">
          {common.map((a) => {
            const isHeld = held.has(`${a.code}:${a.issuer}`);
            return (
              <div key={a.code} className="row g12 add-asset-row">
                <AssetLogo code={a.code} size={34} />
                <div className="f1 min0">
                  <div className="add-asset-code">{a.code}</div>
                  <div className="add-asset-issuer">{a.issuer.slice(0, 4)}…{a.issuer.slice(-4)}</div>
                </div>
                {isHeld ? (
                  <span className="add-asset-held">✓ {t('addAsset.held')}</span>
                ) : (
                  <button
                    onClick={() => addPreset(a.code, a.issuer)}
                    disabled={store.busy}
                    title={t('addAsset.add')}
                    className={store.busy && adding !== a.code ? 'glass-soft center shrink0 add-asset-plus is-dim' : 'glass-soft center shrink0 add-asset-plus'}
                  >
                    {adding === a.code ? <Spinner color="var(--text)" /> : '+'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="glass add-asset-none">
          {t('addAsset.none')}
        </div>
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
          <PrimaryButton disabled={!ok} onClick={addManual}>{store.busy && !adding ? <Spinner /> : t('addAsset.add')}</PrimaryButton>
        </>
      )}
    </div>
  );
}
