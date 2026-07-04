import { useEffect, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner, AssetLogo } from '@/components/parts';
import { Field } from '@/components/screens/Onboarding';
import { isValidPublicKey } from '@/lib/wallet';
import { resolveAssetIssuer } from '@/lib/stellar';

/* ---------------------------- ADD ASSET ----------------------------- */
// Issuers we trust outright per network; everything else is resolved from Horizon
// (so testnet variants and less-common assets get the right, real issuer).
const KNOWN_ISSUERS: Record<string, { public?: string; testnet?: string }> = {
  USDC: {
    public: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    testnet: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  },
  // BlindPay's dev/test stablecoin (used by the fiat on/off-ramp) — testnet only.
  USDB: { testnet: 'GCQSSIMOW5OCGULZATDXKU5MOJBOMFX6G65X6CXZDQ7AIB3SKFUZ67NX' },
  EURC: { public: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2' },
  AQUA: { public: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA' },
  yXLM: { public: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55' },
};

// Common asset codes offered in the quick list; the issuer is resolved per network,
// so each one only shows up when it actually exists on the current network (USDB is
// testnet-only, so it appears only there).
const COMMON_CODES = ['USDC', 'USDB', 'EURC', 'AQUA', 'yXLM', 'MGUSD', 'USDY', 'YLDS', 'AUDD', 'GYEN', 'ZUSD', 'ARST', 'BRL'];

export function AddAsset({ store }: { store: WalletStore }) {
  const t = store.t;
  const [code, setCode] = useState('');
  const [issuer, setIssuer] = useState('');
  const [adding, setAdding] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  const issuerOk = isValidPublicKey(issuer.trim());
  const ok = code.trim().length >= 1 && code.trim().length <= 12 && issuerOk && !store.busy;
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
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '12px 0 18px' }}>
        {t('addAsset.desc')}
      </div>

      <div className="label-up" style={{ marginBottom: '10px' }}>{t('addAsset.common')}</div>

      {loading ? (
        <div className="glass" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', borderRadius: '18px', padding: '26px', marginBottom: '18px', color: C.muted, fontSize: '13px', fontWeight: 600 }}>
          <Spinner color="var(--text)" /> {t('addAsset.loading')}
        </div>
      ) : common.length ? (
        <div className="glass" style={{ borderRadius: '18px', overflow: 'hidden', marginBottom: '18px' }}>
          {common.map((a, i) => {
            const isHeld = held.has(`${a.code}:${a.issuer}`);
            return (
              <div key={a.code} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderBottom: i < common.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
                <AssetLogo code={a.code} size={34} />
                <div className="f1 min0">
                  <div style={{ fontSize: '14.5px', fontWeight: 700 }}>{a.code}</div>
                  <div style={{ fontSize: '11.5px', color: C.dim, fontWeight: 600, fontFamily: 'monospace' }}>{a.issuer.slice(0, 4)}…{a.issuer.slice(-4)}</div>
                </div>
                {isHeld ? (
                  <span style={{ fontSize: '12px', fontWeight: 800, color: C.accent }}>✓ {t('addAsset.held')}</span>
                ) : (
                  <button
                    onClick={() => addPreset(a.code, a.issuer)}
                    disabled={store.busy}
                    title={t('addAsset.add')}
                    className="glass-soft" style={{ flexShrink: 0, width: '40px', height: '40px', borderRadius: '50%', color: 'var(--text)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 700, lineHeight: 1, cursor: store.busy ? 'default' : 'pointer', opacity: store.busy && adding !== a.code ? 0.4 : 1 }}
                  >
                    {adding === a.code ? <Spinner color="var(--text)" /> : '+'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="glass" style={{ borderRadius: '14px', padding: '14px', marginBottom: '18px', fontSize: '12.5px', color: C.muted, fontWeight: 600, lineHeight: 1.55 }}>
          {t('addAsset.none')}
        </div>
      )}

      {!showCustom ? (
        <button onClick={() => setShowCustom(true)} className="glass-soft" style={{ width: '100%', height: '54px', color: 'var(--text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '14.5px', fontWeight: 800, cursor: 'pointer' }}>
          ＋ {t('addAsset.custom')}
        </button>
      ) : (
        <>
          <div className="label-up" style={{ marginBottom: '10px' }}>{t('addAsset.manual')}</div>
          <Field label={t('addAsset.code')} value={code} onChange={(v) => setCode(v.toUpperCase().slice(0, 12))} placeholder="USDC" />
          <label style={{ display: 'block', marginBottom: '6px' }}>
            <div className="label-up" style={{ marginBottom: '7px' }}>{t('addAsset.issuer')}</div>
            <input value={issuer} onChange={(e) => setIssuer((e.target as HTMLInputElement).value.trim())} placeholder="G…" className="input" style={{ fontSize: '13px', fontFamily: 'monospace' }} />
          </label>
          <div style={{ fontSize: '12px', fontWeight: 700, color: !issuer ? 'transparent' : issuerOk ? C.accent : C.danger, minHeight: '15px', marginBottom: '14px' }}>
            {!issuer ? '·' : issuerOk ? '✓' : t('addAsset.invalidIssuer')}
          </div>
          <PrimaryButton disabled={!ok} onClick={addManual}>{store.busy && !adding ? <Spinner /> : t('addAsset.add')}</PrimaryButton>
        </>
      )}
    </div>
  );
}
