import { useEffect, useState } from 'react';
import type { WalletStore } from '../store';
import { C, PrimaryButton, BackBar, NumberPad, Spinner, AssetLogo, inputStyle } from '../parts';
import { qrDataUrl } from '@/lib/qr';
import { buildSep7Pay } from '@/lib/sep7';
import { copyText, readText } from '@/lib/clipboard';
import { computePortfolio } from '@/lib/portfolio';
import { fmt, trim, shortAddr } from '@/lib/format';
import { explorerTxUrl, normalizeAmount } from '@/lib/stellar';
import { isValidPublicKey } from '@/lib/wallet';

/** Numeric keypad editing with Stellar's 7-decimal limit. */
function editAmount(v: string, d: string): string {
  let next = v;
  if (d === 'back') {
    next = v.length <= 1 ? '0' : v.slice(0, -1);
  } else if (d === '.') {
    if (!v.includes('.')) next = v + '.';
  } else {
    next = v === '0' ? d : v + d;
  }
  if (next.includes('.') && next.split('.')[1].length > 7) return v;
  if (next.replace('.', '').replace(/^0+/, '').length > 12) return v;
  return next;
}

function spendableXlm(store: WalletStore): number {
  const acc = store.account;
  if (!acc || !acc.exists) return 0;
  const minBalance = (2 + acc.subentryCount) * 0.5; // base reserve
  return Math.max(0, acc.xlm - minBalance - 0.001);
}

/* ----------------------------- RECEIVE ------------------------------ */
export function Receive({ store }: { store: WalletStore }) {
  const t = store.t;
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const pub = store.meta?.publicKey ?? '';

  useEffect(() => {
    // Encode a SEP-0007 payment request so other Stellar wallets can pre-fill the send.
    if (pub) qrDataUrl(buildSep7Pay({ destination: pub })).then(setQr).catch(() => {});
  }, [pub]);

  const copy = async () => {
    await copyText(pub);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: t('receive.stellarAddress'), text: pub });
      else copy();
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 20px 30px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('receive.title')} onBack={() => store.go('home', 'home')} />
      <div style={{ textAlign: 'center', color: C.muted, fontSize: '13px', fontWeight: 600, margin: '18px 0 22px' }}>
        {t('receive.desc')}
      </div>
      <div style={{ background: '#fff', borderRadius: '24px', padding: '18px', width: '224px', margin: '0 auto 24px' }}>
        {qr ? (
          <img src={qr} width="188" height="188" alt="QR" style={{ display: 'block', width: '188px', height: '188px', margin: '0 auto' }} />
        ) : (
          <div style={{ width: '188px', height: '188px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner color="#0a0c0b" /></div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...C.glassSoft, padding: '8px 16px 8px 9px', borderRadius: '30px' }}>
          <AssetLogo code="XLM" size={26} />
          <span style={{ fontSize: '14px', fontWeight: 700 }}>{t('receive.stellarAddress')}</span>
        </div>
      </div>
      <div style={{ ...C.glass, borderRadius: '16px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600, marginBottom: '5px' }}>{t('receive.addressLabel')}</div>
          <div style={{ fontSize: '12.5px', fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.4, fontFamily: 'monospace' }}>{pub}</div>
        </div>
        <div onClick={copy} style={{ flexShrink: 0, width: '40px', height: '40px', borderRadius: '12px', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: copied ? C.accent : C.muted }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={copy} style={{ flex: 1, height: '54px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{copied ? t('common.copied') : t('common.copy')}</button>
        <button onClick={share} style={{ flex: 1, height: '54px', background: C.accent, color: 'var(--on-accent)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>{t('common.share')}</button>
      </div>
    </div>
  );
}

/* ------------------------------- SEND ------------------------------- */
/** Assets the wallet can send: native XLM (always present) + any trustline balances. */
function sendableAssets(store: WalletStore) {
  const list = (store.account?.balances ?? []).slice();
  // XLM is the native asset — it never depends on a trustline, so it's always available.
  if (!list.some((b) => b.isNative || b.code === 'XLM')) {
    list.unshift({ code: 'XLM', issuer: null, balance: String(store.account?.xlm ?? 0), isNative: true });
  }
  return list.sort((a, b) => (a.isNative ? -1 : b.isNative ? 1 : 0));
}

/** Pill dropdown to choose which asset to send. */
function AssetPicker({ store }: { store: WalletStore }) {
  const [open, setOpen] = useState(false);
  const assets = sendableAssets(store);
  const code = store.send.asset || 'XLM';
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: '8px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', padding: '7px 14px 7px 7px', fontSize: '14px', fontWeight: 800, cursor: 'pointer' }}>
        <AssetLogo code={code} size={26} />
        {code}
        <span style={{ fontSize: '9px', opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▼</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 31, minWidth: '210px', ...C.glass, borderRadius: '16px', padding: '6px', animation: 'fadeUp .18s ease' }}>
            {assets.map((a) => {
              const on = a.code === code;
              return (
                <div key={a.code + (a.issuer ?? '')} onClick={() => { store.setSend({ ...store.send, asset: a.code, amount: '0' }); setOpen(false); }} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '11px', cursor: 'pointer', background: on ? 'var(--surface)' : 'transparent' }}>
                  <AssetLogo code={a.code} size={26} />
                  <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 700 }}>{a.code}</span>
                  <span style={{ fontSize: '12px', color: C.dim, fontWeight: 600 }}>{trim(parseFloat(a.balance) || 0, 4)}</span>
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
  const key = (d: string) => store.setSend({ ...s, amount: editAmount(s.amount, d) });
  const pastePayUrl = async () => {
    const txt = (await readText())?.trim();
    if (txt && store.applySep7(txt)) return;
    store.flash(t('ops.pasteInvalid'), 'err');
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 24px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('send.title')} onBack={() => store.go('home', 'home')} />

      <div style={{ marginTop: '8px', marginBottom: '6px', fontSize: '12px', color: C.dim, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('send.to')}</div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          value={s.to}
          onChange={(e) => {
            const v = (e.target as HTMLInputElement).value.trim();
            // Pasting a SEP-7 link fills destination + amount + memo in one go.
            if (v.toLowerCase().startsWith('web+stellar:') && store.applySep7(v)) return;
            store.setSend({ ...s, to: v });
          }}
          placeholder={t('send.dest')}
          style={{ ...C.glass, ...inputStyle, flex: 1, width: 'auto', minWidth: 0, fontSize: '14px', fontFamily: 'monospace' }}
        />
        <button onClick={() => store.setScreen('scan')} title={t('scan.scanQr')} style={{ flexShrink: 0, width: '54px', height: '54px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><path d="M14 14h3v3M21 14v.01M21 21v-4M14 21h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', margin: '6px 2px 4px', minHeight: '20px' }}>
        <button onClick={pastePayUrl} style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '6px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', padding: '7px 13px', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
          ⛓ {t('ops.pastePay')}
        </button>
        <span style={{ fontSize: '12px', fontWeight: 700, color: !s.to ? 'transparent' : addrValid ? C.accent : C.danger, textAlign: 'right' }}>
          {!s.to ? '·' : addrValid ? t('send.validAddr') : t('send.invalidAddr')}
        </span>
      </div>

      <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
        {/* asset selector sits right next to the amount for a clear, fast edit */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <div style={{ fontSize: '44px', fontWeight: 800, letterSpacing: '-1.5px', fontVariantNumeric: 'tabular-nums' }}>
            {s.amount}
          </div>
          <AssetPicker store={store} />
        </div>
        <div style={{ marginTop: '10px', fontSize: '13px', color: C.dim, fontWeight: 600 }}>
          {price > 0 ? `≈ $${fmt(amt * price, 2)} · ` : ''}{t('send.available')}: {trim(avail, 4)} {code}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', margin: '10px 0 12px' }}>
        {([['25%', 0.25], ['50%', 0.5], ['Máx', 1]] as [string, number][]).map(([l, p]) => (
          <span key={l} onClick={() => setPct(p)} className="tap" style={{ flex: 1, textAlign: 'center', fontSize: '13px', fontWeight: 700, color: C.muted, ...C.glassSoft, padding: '11px', borderRadius: '999px', cursor: 'pointer' }}>{l}</span>
        ))}
      </div>

      <input
        value={s.memo}
        onChange={(e) => store.setSend({ ...s, memo: (e.target as HTMLInputElement).value.slice(0, 28) })}
        placeholder={t('send.memo')}
        style={{ ...C.glass, ...inputStyle, fontSize: '13px', marginBottom: '12px' }}
      />

      <NumberPad onKey={key} />
      <div style={{ height: '12px' }} />
      <PrimaryButton disabled={!ok} onClick={() => store.setScreen('confirm')}>
        {amt > avail && amt > 0 ? t('send.insufficient') : t('common.continue')}
      </PrimaryButton>
    </div>
  );
}

/* ----------------------------- CONFIRM ------------------------------ */
export function Confirm({ store }: { store: WalletStore }) {
  const t = store.t;
  const s = store.send;
  const code = s.asset || 'XLM';
  const amt = parseFloat(s.amount) || 0;
  const price = store.prices[code]?.usd ?? 0;
  const from = store.meta?.publicKey ?? '';

  let normalized = s.amount;
  try {
    normalized = normalizeAmount(s.amount);
  } catch {
    /* keep */
  }

  const rows: [string, string, string?][] = [
    [t('confirm.from'), shortAddr(from, 6, 6), t('confirm.yourWallet')],
    [t('confirm.to'), shortAddr(s.to, 6, 6)],
    [t('confirm.amount'), `${normalized} ${code}`, price > 0 ? '≈ $' + fmt(amt * price, 2) : undefined],
    [t('confirm.network'), `Stellar ${store.network.label}`],
    [t('confirm.fee'), '≈ 0.00001 XLM'],
  ];
  if (s.memo) rows.push([t('confirm.memo'), s.memo]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '2px 20px 24px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('confirm.title')} onBack={() => store.setScreen('send')} />
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '20px 0 8px' }}>
        <AssetLogo code={code} size={64} />
      </div>
      <div style={{ textAlign: 'center', fontSize: '30px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '4px' }}>{normalized} {code}</div>
      <div style={{ textAlign: 'center', fontSize: '14px', color: C.dim, fontWeight: 600, marginBottom: '26px' }}>{price > 0 ? `≈ $${fmt(amt * price, 2)}` : ' '}</div>

      <div style={{ ...C.glass, borderRadius: '18px', padding: '6px 18px' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 0', borderBottom: i < rows.length - 1 ? '1px solid var(--hairline)' : 'none', gap: '12px' }}>
            <span style={{ color: C.muted, fontSize: '14px', fontWeight: 600 }}>{r[0]}</span>
            <div style={{ textAlign: 'right', minWidth: 0 }}>
              <div style={{ fontSize: '14.5px', fontWeight: 700, fontFamily: r[1].includes('…') ? 'monospace' : 'inherit' }}>{r[1]}</div>
              {r[2] && <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600 }}>{r[2]}</div>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1 }} />
      <PrimaryButton disabled={store.busy} onClick={() => store.submitSend()}>
        {store.busy ? <Spinner /> : t('confirm.cta')}
      </PrimaryButton>
    </div>
  );
}

/* ----------------------------- SUCCESS ------------------------------ */
export function Success({ store }: { store: WalletStore }) {
  const t = store.t;
  const si = store.successInfo;
  const isErr = si?.kind === 'err';
  const ringColor = isErr ? '#ff5d5d' : '#23c552'; // red on failure, green on success
  const goHome = () => {
    store.setSuccessInfo(null);
    if (store.session) store.go('home', 'home');
    else store.setScreen('unlock');
  };
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '2px 20px 24px' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ position: 'relative', width: '96px', height: '96px', marginBottom: '26px' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: ringColor, animation: 'ring 1.6s ease-out infinite' }} />
          <div style={{ position: 'relative', width: '96px', height: '96px', borderRadius: '50%', background: ringColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pop .5s ease', boxShadow: `0 12px 34px ${ringColor}55` }}>
            {isErr ? (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
            ) : (
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4 10-11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </div>
        </div>
        <div style={{ fontSize: '26px', fontWeight: 800, marginBottom: '10px' }}>{si?.title ?? 'Listo'}</div>
        <div style={{ fontSize: '14px', color: C.muted, fontWeight: 600, maxWidth: '270px' }}>{si?.msg ?? ''}</div>
      </div>
      {si?.rows?.length ? (
        <div style={{ ...C.glass, borderRadius: '18px', padding: '6px 18px', marginBottom: '14px' }}>
          {si.rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 0', borderBottom: i < si.rows.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
              <span style={{ color: C.muted, fontSize: '14px', fontWeight: 600 }}>{r.label}</span>
              <span style={{ fontSize: '14.5px', fontWeight: 700 }}>{r.val}</span>
            </div>
          ))}
        </div>
      ) : null}
      {si?.hash && (
        <a href={explorerTxUrl(store.network, si.hash)} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', color: C.muted, fontSize: '13px', fontWeight: 700, padding: '10px', textDecoration: 'none', marginBottom: '4px' }}>
          {t('success.viewTx')}
        </a>
      )}
      <PrimaryButton onClick={goHome}>{store.session ? t('success.viewWallet') : t('common.continue')}</PrimaryButton>
    </div>
  );
}

/* ------------------------------- SWAP ------------------------------- */
export function Swap({ store }: { store: WalletStore }) {
  const t = store.t;
  const { rows } = computePortfolio(store.account, store.prices);
  const fromBal = rows.find((r) => r.code === 'XLM');
  const fromPrice = store.prices.XLM?.usd ?? 0;
  const toPrice = store.prices.USDC?.usd ?? 1;
  const [pay, setPay] = useState('1');
  const payNum = parseFloat(pay) || 0;
  const receive = toPrice ? (payNum * fromPrice) / toPrice : 0;

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 104px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('swap.title')} onBack={() => store.go('home', 'home')} />

      <div style={{ position: 'relative', marginTop: '6px' }}>
        <div style={{ ...C.glass, borderRadius: '20px', padding: '18px' }}>
          <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '14px' }}>{t('swap.pay')}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pill code="XLM" />
            <input value={pay} onChange={(e) => setPay((e.target as HTMLInputElement).value)} inputMode="decimal" style={{ width: '120px', background: 'transparent', border: 'none', textAlign: 'right', color: 'var(--text)', fontSize: '28px', fontWeight: 800, outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', color: C.dim, fontSize: '12px', fontWeight: 600 }}>
            <span>{t('swap.balance')}: {fromBal ? trim(fromBal.amount, 4) : '0'} XLM</span>
            <span>≈ ${fmt(payNum * fromPrice, 2)}</span>
          </div>
        </div>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '44px', height: '44px', borderRadius: '50%', ...C.glassSoft, border: '4px solid #080808', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', zIndex: 2 }}>⇅</div>
        <div style={{ ...C.glass, borderRadius: '20px', padding: '18px', marginTop: '10px' }}>
          <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '14px' }}>{t('swap.receiveEst')}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pill code="USDC" />
            <div style={{ fontSize: '28px', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{trim(receive, 4)}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px', color: C.dim, fontSize: '12px', fontWeight: 600 }}>≈ ${fmt(receive * toPrice, 2)}</div>
        </div>
      </div>

      <div style={{ ...C.glass, borderRadius: '14px', padding: '14px', marginTop: '16px', fontSize: '12.5px', color: C.muted, fontWeight: 600, lineHeight: 1.55 }}>
        {t('swap.note')}
      </div>

      <div style={{ flex: 1 }} />
      <PrimaryButton onClick={() => store.flash(t('swap.soon'), 'info')}>{t('common.continue')}</PrimaryButton>
    </div>
  );
}

function Pill({ code }: { code: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...C.glassSoft, padding: '7px 14px 7px 8px', borderRadius: '30px' }}>
      <AssetLogo code={code} size={28} />
      <span style={{ fontSize: '15px', fontWeight: 700 }}>{code}</span>
    </div>
  );
}
