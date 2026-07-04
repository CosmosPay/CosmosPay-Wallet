import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner, AssetLogo, inputStyle } from '@/components/parts';
import { Field } from '@/components/screens/Onboarding';
import { isValidPublicKey } from '@/lib/wallet';
import { parseStellarQr } from '@/lib/sep7';
import { copyText, readText } from '@/lib/clipboard';
import { inspectXdr, signXdr, submitXdr, resolveAssetIssuer, type TxSummary } from '@/lib/stellar';
import { buildKind } from '@/lib/platform';

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
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState('');
  // Bumping this re-runs the camera effect -> re-triggers the permission prompt.
  const [retry, setRetry] = useState(0);
  // Available video inputs (populated once permission is granted) + the user's pick.
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [devOpen, setDevOpen] = useState(false);

  /** Shared for camera + uploaded images: parse the QR text and jump to Send. */
  const applyScan = (text: string): boolean => {
    const parsed = parseStellarQr(text);
    if (!parsed) return false;
    store.setSend({
      ...store.send,
      to: parsed.destination,
      ...(parsed.amount ? { amount: parsed.amount } : {}),
      ...(parsed.memo ? { memo: parsed.memo.slice(0, 28) } : {}),
    });
    store.setScreen('send');
    return true;
  };

  /** Fallback without camera: decode a QR from any image blob (file or clipboard). */
  const decodeBlob = async (blob: Blob) => {
    try {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      // Cap the working size (perf) while keeping enough pixels for dense codes.
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const res = jsQR(data.data, canvas.width, canvas.height); // default also tries inverted
      if (!res?.data || !applyScan(res.data)) store.flash(t('scan.noQr'), 'err');
    } catch {
      store.flash(t('scan.noQr'), 'err');
    }
  };
  const decodeRef = useRef(decodeBlob);
  decodeRef.current = decodeBlob;

  const onFile = (e: { target: HTMLInputElement }) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void decodeBlob(f);
  };

  /** Read an image straight from the clipboard (button; Ctrl+V also works below). */
  const pasteImage = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((tp) => tp.startsWith('image/'));
        if (type) {
          void decodeBlob(await it.getType(type));
          return;
        }
      }
      store.flash(t('scan.noClipImg'), 'info');
    } catch {
      store.flash(t('scan.noClipImg'), 'err');
    }
  };

  // Ctrl/Cmd+V anywhere on this screen decodes a pasted image too.
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const item = Array.from(ev.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) {
        ev.preventDefault();
        void decodeRef.current(f);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  /** Extension popups often can't render the camera prompt — open the helper page
   *  in a full tab, where it can; the grant persists for the extension origin. */
  const openGrantTab = () => {
    const ext = globalThis as unknown as { chrome?: any; browser?: any };
    const url = (ext.chrome ?? ext.browser)?.runtime?.getURL?.('camera.html');
    if (url) window.open(url, '_blank');
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    setError('');

    // Accept a bare G-address or a SEP-0007 payment URI (web+stellar:pay?…).
    const finish = (text: string) => {
      if (!applyScan(text)) return false;
      cleanup();
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
        // Explicit device when the user picked one; otherwise prefer the back camera.
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' },
        });
        if (stopped) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          raf = requestAnimationFrame(tick);
        }
        // With permission granted, device labels become readable — offer a picker.
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          setDevices(all.filter((d) => d.kind === 'videoinput'));
        } catch {
          /* enumeration unavailable — keep the default camera */
        }
      } catch {
        setError(t('scan.denied'));
      }
    })();

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry, deviceId]);

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 28px', animation: 'fadeUp .3s ease' }}>
      {/* Back to wherever the scanner was opened from (send, home, operations, drawer…). */}
      <BackBar title={t('scan.title')} onBack={() => store.back('send')} />
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, textAlign: 'center', margin: '12px 0 18px' }}>{t('scan.point')}</div>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: '24px', overflow: 'hidden', ...C.glass, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {error ? (
          <div style={{ padding: '24px', textAlign: 'center', color: C.muted, fontSize: '13.5px', fontWeight: 600, lineHeight: 1.5 }}>
            {error}
            {/* In the extension, the popup can't render the camera prompt — this opens
                camera.html in a tab where the browser CAN ask explicitly. */}
            {buildKind() === 'ext' && (
              <button
                onClick={openGrantTab}
                style={{ display: 'block', width: '100%', marginTop: '14px', height: '44px', ...C.glassBright, color: 'var(--primary-text)', border: 'none', borderRadius: '999px', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}
              >
                {t('scan.grant')}
              </button>
            )}
            {/* Re-running the effect re-calls getUserMedia -> re-asks for permission. */}
            <button
              onClick={() => setRetry((r) => r + 1)}
              style={{ display: 'block', width: '100%', marginTop: '10px', height: '44px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}
            >
              {t('scan.retry')}
            </button>
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: '16%', border: '3px solid rgba(255,255,255,.9)', borderRadius: '20px', boxShadow: '0 0 0 2000px rgba(0,0,0,.35)' }} />
          </>
        )}
      </div>

      {/* More than one camera? Fully-styled custom picker (no native <select> —
          its option list can't be themed), same pattern as the network dropdown. */}
      {devices.length > 1 && !error && (
        <div style={{ position: 'relative', marginTop: '12px', flexShrink: 0 }}>
          <button
            onClick={() => setDevOpen((o) => !o)}
            style={{ width: '100%', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', padding: '0 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
          >
            <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {deviceId
                ? devices.find((d) => d.deviceId === deviceId)?.label || t('scan.device')
                : `${t('scan.device')} · auto`}
            </span>
            <span style={{ fontSize: '9px', opacity: 0.7, transform: devOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}>▼</span>
          </button>
          {devOpen && (
            <>
              <div onClick={() => setDevOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
              <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)', zIndex: 31, background: 'var(--bg)', border: '1px solid var(--glass-border)', boxShadow: '0 18px 50px rgba(0,0,0,.5)', borderRadius: '16px', padding: '6px', animation: 'fadeUp .18s ease' }}>
                {[{ id: '', label: `${t('scan.device')} · auto` }, ...devices.map((d, i) => ({ id: d.deviceId, label: d.label || `${t('scan.device')} ${i + 1}` }))].map((opt) => {
                  const on = opt.id === deviceId;
                  return (
                    <div
                      key={opt.id || 'auto'}
                      onClick={() => { setDeviceId(opt.id); setDevOpen(false); }}
                      className="tap"
                      style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '11px 13px', borderRadius: '11px', cursor: 'pointer', background: on ? 'var(--surface)' : 'transparent', color: 'var(--text)' }}
                    >
                      <span style={{ flex: 1, fontSize: '13px', fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{opt.label}</span>
                      {on && <span style={{ color: C.accent, fontWeight: 800, flexShrink: 0 }}>✓</span>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* No camera / permission denied? Decode a QR from an image instead — the two
          fallbacks stack full-width so their labels never get cramped. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px', flexShrink: 0 }}>
        <button onClick={() => fileRef.current?.click()} className="glass-soft pill-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8" /><path d="M3 16l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="9" cy="8" r="1.6" fill="currentColor" /></svg>
          {t('scan.upload')}
        </button>
        <button onClick={pasteImage} className="glass-soft pill-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}><rect x="6" y="4" width="12" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="M9 4.5V3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5v1" stroke="currentColor" strokeWidth="1.8" /></svg>
          {t('scan.paste')}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />

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
      {/* flexShrink 0: inside a flex-column scroll container the card would otherwise
          COMPRESS to fit (squashed rows, nothing to scroll) instead of overflowing. */}
      <div style={{ ...C.glass, borderRadius: '18px', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
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
