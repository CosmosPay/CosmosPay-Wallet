import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner, AssetLogo, inputStyle } from '@/components/parts';
import { Field } from '@/components/screens/Onboarding';
import { isValidPublicKey } from '@/lib/wallet';
import { parseStellarQr } from '@/lib/sep7';
import { copyText, readText } from '@/lib/clipboard';
import { inspectXdr, signXdr, submitXdr, resolveAssetIssuer, type TxSummary } from '@/lib/stellar';

/* --------------------------- ADD NETWORK ---------------------------- */
export function AddNetwork({ store }: { store: WalletStore }) {
  const t = store.t;
  const [name, setName] = useState('');
  const [horizon, setHorizon] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length > 1 && /^https?:\/\/.+/.test(horizon.trim()) && passphrase.trim().length > 3 && !busy;

  const save = async () => {
    setBusy(true);
    try {
      await store.addNetwork({ label: name.trim(), horizon: horizon.trim().replace(/\/$/, ''), passphrase: passphrase.trim() });
      store.go('home', 'home');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('net.addTitle')} onBack={() => store.go(store.session ? 'home' : 'home', 'home')} />
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '12px 0 18px' }}>
        {t('settings.networkDesc')}
      </div>
      <Field label={t('net.name')} value={name} onChange={setName} placeholder="Futurenet" />
      <Field label={t('net.horizon')} value={horizon} onChange={setHorizon} placeholder="https://horizon-futurenet.stellar.org" />
      <Field label={t('net.passphrase')} value={passphrase} onChange={setPassphrase} placeholder="Test SDF Future Network ; October 2022" />
      <div style={{ flex: 1 }} />
      <PrimaryButton disabled={!ok} onClick={save}>{busy ? <Spinner /> : t('net.save')}</PrimaryButton>
    </div>
  );
}

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
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 40px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('addAsset.title')} onBack={() => store.go('home', 'home')} />
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '12px 0 18px' }}>
        {t('addAsset.desc')}
      </div>

      <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('addAsset.common')}</div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', ...C.glass, borderRadius: '18px', padding: '26px', marginBottom: '18px', color: C.muted, fontSize: '13px', fontWeight: 600 }}>
          <Spinner color="var(--text)" /> {t('addAsset.loading')}
        </div>
      ) : common.length ? (
        <div style={{ ...C.glass, borderRadius: '18px', overflow: 'hidden', marginBottom: '18px' }}>
          {common.map((a, i) => {
            const isHeld = held.has(`${a.code}:${a.issuer}`);
            return (
              <div key={a.code} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderBottom: i < common.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
                <AssetLogo code={a.code} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
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
                    style={{ flexShrink: 0, width: '40px', height: '40px', borderRadius: '50%', ...C.glassSoft, color: 'var(--text)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 700, lineHeight: 1, cursor: store.busy ? 'default' : 'pointer', opacity: store.busy && adding !== a.code ? 0.4 : 1 }}
                  >
                    {adding === a.code ? <Spinner color="var(--text)" /> : '+'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ ...C.glass, borderRadius: '14px', padding: '14px', marginBottom: '18px', fontSize: '12.5px', color: C.muted, fontWeight: 600, lineHeight: 1.55 }}>
          {t('addAsset.none')}
        </div>
      )}

      {!showCustom ? (
        <button onClick={() => setShowCustom(true)} style={{ width: '100%', height: '54px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '14.5px', fontWeight: 800, cursor: 'pointer' }}>
          ＋ {t('addAsset.custom')}
        </button>
      ) : (
        <>
          <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('addAsset.manual')}</div>
          <Field label={t('addAsset.code')} value={code} onChange={(v) => setCode(v.toUpperCase().slice(0, 12))} placeholder="USDC" />
          <label style={{ display: 'block', marginBottom: '6px' }}>
            <div style={{ fontSize: '12px', color: C.dim, fontWeight: 700, marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('addAsset.issuer')}</div>
            <input value={issuer} onChange={(e) => setIssuer((e.target as HTMLInputElement).value.trim())} placeholder="G…" style={{ ...C.glass, ...inputStyle, fontSize: '13px', fontFamily: 'monospace' }} />
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

/* ----------------------------- SCAN QR ------------------------------ */
export function ScanQR({ store }: { store: WalletStore }) {
  const t = store.t;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    const finish = (text: string) => {
      // Accept a bare G-address or a SEP-0007 payment URI (web+stellar:pay?destination=G…&amount=…&memo=…)
      const parsed = parseStellarQr(text);
      if (!parsed) return false;
      store.setSend({
        ...store.send,
        to: parsed.destination,
        ...(parsed.amount ? { amount: parsed.amount } : {}),
        ...(parsed.memo ? { memo: parsed.memo.slice(0, 28) } : {}),
      });
      cleanup();
      store.setScreen('send');
      return true;
    };

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx && w && h) {
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const res = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
          if (res && res.data && finish(res.data)) return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const cleanup = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          raf = requestAnimationFrame(tick);
        }
      } catch {
        setError(t('scan.denied'));
      }
    })();

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('scan.title')} onBack={() => store.setScreen('send')} />
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, textAlign: 'center', margin: '12px 0 18px' }}>{t('scan.point')}</div>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: '24px', overflow: 'hidden', ...C.glass, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {error ? (
          <div style={{ padding: '24px', textAlign: 'center', color: C.muted, fontSize: '13.5px', fontWeight: 600, lineHeight: 1.5 }}>{error}</div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: '16%', border: '3px solid rgba(255,255,255,.9)', borderRadius: '20px', boxShadow: '0 0 0 2000px rgba(0,0,0,.35)' }} />
          </>
        )}
      </div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}

/* --------------------------- OPERATIONS HUB ------------------------- */
function OpRow({ glyph, label, sub, onClick }: { glyph: string; label: string; sub?: string; onClick: () => void }) {
  return (
    <div onClick={onClick} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '15px 16px', cursor: 'pointer' }}>
      <div style={{ flexShrink: 0, width: '38px', height: '38px', borderRadius: '50%', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px' }}>{glyph}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '15px', fontWeight: 700 }}>{label}</div>
        {sub && <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600 }}>{sub}</div>}
      </div>
      <span style={{ color: '#4f5754', fontSize: '18px' }}>›</span>
    </div>
  );
}

export function Operations({ store }: { store: WalletStore }) {
  const t = store.t;

  const pastePayUrl = async () => {
    const txt = (await readText())?.trim();
    if (txt && store.applySep7(txt)) store.setScreen('send');
    else store.flash(t('ops.pasteInvalid'), 'err');
  };

  const rows: { glyph: string; label: string; sub?: string; onClick: () => void }[] = [
    { glyph: '✎', label: t('ops.signTx'), sub: t('ops.signTxSub'), onClick: () => store.setScreen('sign-tx') },
    { glyph: '⛓', label: t('ops.pastePay'), sub: t('ops.pastePaySub'), onClick: pastePayUrl },
    { glyph: '⛶', label: t('scan.scanQr'), onClick: () => store.setScreen('scan') },
    { glyph: '＋', label: t('addAsset.title'), onClick: () => store.setScreen('add-asset') },
    { glyph: '⌗', label: t('net.add'), onClick: () => store.setScreen('add-network') },
    { glyph: '⚷', label: t('profile.exportKeys'), onClick: () => store.setScreen('export') },
    { glyph: '⚙', label: t('profile.settings'), onClick: () => store.setScreen('settings') },
  ];

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('ops.title')} onBack={() => store.go('home', 'home')} />
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '12px 0 18px' }}>{t('ops.desc')}</div>
      <div style={{ ...C.glass, borderRadius: '18px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
            <OpRow glyph={r.glyph} label={r.label} sub={r.sub} onClick={r.onClick} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------- SIGN TRANSACTION ----------------------- */
export function SignTx({ store }: { store: WalletStore }) {
  const t = store.t;
  const [xdr, setXdr] = useState('');
  const [summary, setSummary] = useState<TxSummary | null>(null);
  const [signed, setSigned] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const onXdr = (v: string) => {
    setXdr(v);
    setErr('');
    setSigned('');
    const trimmed = v.trim();
    if (!trimmed) {
      setSummary(null);
      return;
    }
    try {
      setSummary(inspectXdr(store.network, trimmed));
    } catch {
      setSummary(null);
    }
  };

  const paste = async () => onXdr((await readText())?.trim() ?? '');

  const sign = async () => {
    if (!store.session) return;
    const okSig = await store.requestSignature({ title: t('confirmSig.signTitle'), message: t('confirmSig.signMsg') });
    if (!okSig) return;
    setErr('');
    try {
      setSigned(signXdr(store.network, store.session.secret, xdr.trim()));
    } catch (e) {
      setErr((e as Error).message || t('sign.invalid'));
    }
  };

  const submit = async () => {
    const okSig = await store.requestSignature({ title: t('confirmSig.submitTitle'), message: t('confirmSig.submitMsg') });
    if (!okSig) return;
    setBusy(true);
    setErr('');
    try {
      const { hash } = await submitXdr(store.network, (signed || xdr).trim());
      store.setSuccessInfo({ kind: 'ok', title: t('sign.submitted'), msg: '', rows: [], hash });
      store.setScreen('success');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copySigned = async () => {
    await copyText(signed);
    store.flash(t('common.copied'), 'ok');
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('sign.title')} onBack={() => store.setScreen('operations')} />
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '12px 0 16px' }}>{t('sign.desc')}</div>

      <textarea
        value={xdr}
        onChange={(e) => onXdr((e.target as HTMLTextAreaElement).value)}
        placeholder="AAAAAgAAAAB…"
        rows={4}
        style={{ width: '100%', ...C.glass, borderRadius: '18px', padding: '14px 16px', color: 'var(--text)', fontSize: '12.5px', fontWeight: 600, resize: 'none', outline: 'none', fontFamily: 'monospace', lineHeight: 1.5, marginBottom: '10px' }}
      />
      <button onClick={paste} style={{ alignSelf: 'flex-start', height: '40px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', padding: '0 18px', fontSize: '13px', fontWeight: 800, cursor: 'pointer', marginBottom: '16px' }}>
        {t('sign.paste')}
      </button>

      {summary && (
        <div style={{ ...C.glass, borderRadius: '18px', padding: '6px 16px', marginBottom: '16px' }}>
          {[
            [t('sign.source'), summary.source ? `${summary.source.slice(0, 6)}…${summary.source.slice(-6)}` : '—'],
            [t('sign.fee'), `${summary.fee} stroops`],
            [t('sign.ops'), summary.operations.join(', ') || '—'],
            [t('sign.memo'), summary.memo || '—'],
            [t('sign.signatures'), String(summary.signatures)],
          ].map((r, i, arr) => (
            <div key={r[0]} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
              <span style={{ color: C.muted, fontSize: '13px', fontWeight: 600 }}>{r[0]}</span>
              <span style={{ fontSize: '13px', fontWeight: 700, textAlign: 'right', wordBreak: 'break-word', fontFamily: r[0] === t('sign.source') ? 'monospace' : 'inherit' }}>{r[1]}</span>
            </div>
          ))}
        </div>
      )}

      {signed && (
        <div style={{ ...C.glass, borderRadius: '18px', padding: '14px 16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: C.accent, fontWeight: 800, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('sign.signedLabel')}</div>
          <div style={{ fontSize: '11.5px', fontWeight: 600, wordBreak: 'break-all', fontFamily: 'monospace', lineHeight: 1.5, color: C.muted, marginBottom: '12px' }}>{signed}</div>
          <button onClick={copySigned} style={{ width: '100%', height: '44px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', fontSize: '13.5px', fontWeight: 800, cursor: 'pointer' }}>{t('common.copy')}</button>
        </div>
      )}

      {err && <div style={{ fontSize: '12.5px', fontWeight: 700, color: C.danger, marginBottom: '12px', lineHeight: 1.5 }}>{err}</div>}

      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {!signed ? (
          <PrimaryButton disabled={!summary} onClick={sign}>{t('sign.sign')}</PrimaryButton>
        ) : (
          <PrimaryButton disabled={busy} onClick={submit}>{busy ? <Spinner /> : t('sign.submit')}</PrimaryButton>
        )}
      </div>
    </div>
  );
}
