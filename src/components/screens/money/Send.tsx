import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, AssetLogo } from '@/components/parts';
import { readText } from '@/lib/clipboard';
import { fmt, trim } from '@/lib/format';
import { isValidPublicKey } from '@/lib/wallet';
import { spendableXlm, sendableAssets } from './shared';

/* ------------------------------- SEND ------------------------------- */
/** Pill dropdown to choose which asset to send. */
function AssetPicker({ store }: { store: WalletStore }) {
  const [open, setOpen] = useState(false);
  const assets = sendableAssets(store);
  const code = store.send.asset || 'XLM';
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} className="glass-soft" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text)', border: 'none', borderRadius: '999px', padding: '7px 14px 7px 7px', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
        <AssetLogo code={code} size={26} />
        {code}
        <span style={{ fontSize: '9px', opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▼</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
          <div className="glass" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 31, minWidth: '210px', borderRadius: '16px', padding: '6px', animation: 'fadeUp .18s ease' }}>
            {assets.map((a) => {
              const on = a.code === code;
              return (
                <div key={a.code + (a.issuer ?? '')} onClick={() => { store.setSend({ ...store.send, asset: a.code, amount: '0' }); setOpen(false); }} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '11px', cursor: 'pointer', background: on ? 'var(--surface)' : 'transparent' }}>
                  <AssetLogo code={a.code} size={26} />
                  <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 700 }}>{a.code}</span>
                  <span className="t-dim-12">{trim(parseFloat(a.balance) || 0, 4)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function Send({ store }: { store: WalletStore }) {
  const t = store.t;
  const s = store.send;
  const code = s.asset || 'XLM';
  const isNative = code === 'XLM';
  const bal = store.account?.balances.find((b) => b.code === code);
  const avail = isNative ? spendableXlm(store) : parseFloat(bal?.balance ?? '0') || 0;
  const price = store.prices[code]?.usd ?? 0;
  const amt = parseFloat(s.amount) || 0;
  const addrValid = isValidPublicKey(s.to);
  const amtValid = amt > 0 && amt <= avail;
  const ok = addrValid && amtValid;

  const setPct = (p: number) => store.setSend({ ...s, amount: String(Math.floor(avail * p * 1e7) / 1e7) });
  // Direct keyboard editing (no on-screen pad): digits + one dot, 7 decimals max.
  const editAmountInput = (raw: string) => {
    let v = raw.replace(',', '.').replace(/[^\d.]/g, '');
    const dot = v.indexOf('.');
    if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 7);
    if (v.replace('.', '').length > 12) return;
    store.setSend({ ...s, amount: v });
  };
  const pastePayUrl = async () => {
    const txt = (await readText())?.trim();
    if (txt && store.applySep7(txt)) return;
    store.flash(t('ops.pasteInvalid'), 'err');
  };

  return (
    <div className="scr screen col pb-24">
      <BackBar title={t('send.title')} onBack={() => store.go('home', 'home')} />

      <div style={{ marginTop: '8px', marginBottom: '6px', fontSize: '12px', color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('send.to')}</div>
      <div className="flexr g8">
        <input
          value={s.to}
          onChange={(e) => {
            const v = (e.target as HTMLInputElement).value.trim();
            // Pasting a SEP-7 link fills destination + amount + memo in one go.
            if (v.toLowerCase().startsWith('web+stellar:') && store.applySep7(v)) return;
            store.setSend({ ...s, to: v });
          }}
          placeholder={t('send.dest')}
          className="input" style={{ flex: 1, width: 'auto', minWidth: 0, fontSize: '14px', fontFamily: 'monospace' }}
        />
        <button onClick={() => store.setScreen('scan')} title={t('scan.scanQr')} className="glass-soft" style={{ flexShrink: 0, width: '54px', height: '54px', color: 'var(--text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><path d="M14 14h3v3M21 14v.01M21 21v-4M14 21h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
      {/* Standard-sized control (48px pill), snug under the address row; the
          validity note only takes space once there's something to validate. */}
      <button onClick={pastePayUrl} className="glass-soft pill-btn" style={{ marginTop: '8px' }}>
        ⛓ {t('ops.pastePay')}
      </button>
      {s.to && (
        <div style={{ fontSize: '12px', fontWeight: 700, color: addrValid ? C.accent : C.danger, textAlign: 'right', margin: '6px 2px 0' }}>
          {addrValid ? t('send.validAddr') : t('send.invalidAddr')}
        </div>
      )}

      <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
        {/* asset selector sits right next to the amount; the amount is a real input
            (system keyboard) — no on-screen pad needed on any device */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <input
            value={s.amount}
            onChange={(e) => editAmountInput((e.target as HTMLInputElement).value)}
            inputMode="decimal"
            placeholder="0"
            style={{
              width: `${Math.max(1, s.amount.length || 1)}ch`,
              maxWidth: '230px',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text)',
              fontSize: '44px',
              fontWeight: 800,
              letterSpacing: '-1.5px',
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center',
              padding: 0,
            }}
          />
          <AssetPicker store={store} />
        </div>
        <div style={{ marginTop: '10px', fontSize: '13px', color: C.dim, fontWeight: 600 }}>
          {price > 0 ? `≈ $${fmt(amt * price, 2)} · ` : ''}{t('send.available')}: {trim(avail, 4)} {code}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', margin: '10px 0 12px' }}>
        {([['25%', 0.25], ['50%', 0.5], ['Máx', 1]] as [string, number][]).map(([l, p]) => (
          <span key={l} onClick={() => setPct(p)} className="tap glass-soft" style={{ flex: 1, textAlign: 'center', fontSize: '13px', fontWeight: 700, color: C.muted, padding: '11px', borderRadius: '999px', cursor: 'pointer' }}>{l}</span>
        ))}
      </div>

      {/* memo: standard input metrics (54px pill, 15px type) like every other field */}
      <input
        value={s.memo}
        onChange={(e) => store.setSend({ ...s, memo: (e.target as HTMLInputElement).value.slice(0, 28) })}
        placeholder={t('send.memo')}
        className="input" style={{ marginBottom: '12px' }}
      />

      <div style={{ flex: 1, minHeight: '12px' }} />
      <PrimaryButton disabled={!ok} onClick={() => store.setScreen('confirm')}>
        {amt > avail && amt > 0 ? t('send.insufficient') : t('common.continue')}
      </PrimaryButton>
    </div>
  );
}
