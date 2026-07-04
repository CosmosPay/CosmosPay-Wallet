import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import type { WalletStore } from '@/components/store';
import { C, BackBar } from '@/components/parts';
import { parseStellarQr } from '@/lib/sep7';
import { buildKind } from '@/lib/platform';

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
    <div className="scr screen col">
      {/* Back to wherever the scanner was opened from (send, home, operations, drawer…). */}
      <BackBar title={t('scan.title')} onBack={() => store.back('send')} />
      <div style={{ fontSize: '13.5px', color: C.muted, fontWeight: 600, textAlign: 'center', margin: '12px 0 18px' }}>{t('scan.point')}</div>
      <div className="glass" style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: '24px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {error ? (
          <div style={{ padding: '24px', textAlign: 'center', color: C.muted, fontSize: '13.5px', fontWeight: 600, lineHeight: 1.5 }}>
            {error}
            {/* In the extension, the popup can't render the camera prompt — this opens
                camera.html in a tab where the browser CAN ask explicitly. */}
            {buildKind() === 'ext' && (
              <button
                onClick={openGrantTab}
                className="glass-bright" style={{ display: 'block', width: '100%', marginTop: '14px', height: '44px', color: 'var(--primary-text)', border: 'none', borderRadius: '999px', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}
              >
                {t('scan.grant')}
              </button>
            )}
            {/* Re-running the effect re-calls getUserMedia -> re-asks for permission. */}
            <button
              onClick={() => setRetry((r) => r + 1)}
              className="glass-soft" style={{ display: 'block', width: '100%', marginTop: '10px', height: '44px', color: 'var(--text)', border: 'none', borderRadius: '999px', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}
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
            className="glass-soft" style={{ width: '100%', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', color: 'var(--text)', border: 'none', borderRadius: '999px', padding: '0 18px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
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
