import { useEffect, useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, GhostButton, BackBar, Spinner, AssetLogo, Logo, inputStyle, EnableReceivingCard } from '@/components/parts';
import { qrDataUrl } from '@/lib/qr';
import { buildSep7Pay } from '@/lib/sep7';
import { copyText, readText } from '@/lib/clipboard';
import { fmt, trim, shortAddr } from '@/lib/format';
import { explorerTxUrl, networkEnv, normalizeAmount, type HistoryOp } from '@/lib/stellar';
import { isValidPublicKey } from '@/lib/wallet';
import type { SwapQuote, PayIntent } from '@/lib/cosmospay';

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
      <BackBar title={t('receive.title')} onBack={() => store.back('home')} />
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

      <div onClick={() => store.setScreen('paylink')} className="tap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px', borderRadius: '16px', cursor: 'pointer', marginTop: '14px', ...C.glassSoft }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '18px' }}>🔗</div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 800 }}>{t('paylink.title')}</div>
            <div style={{ fontSize: '12px', color: C.muted, fontWeight: 600 }}>{t('paylink.entryDesc')}</div>
          </div>
        </div>
        <span style={{ color: C.dim, fontSize: '18px' }}>›</span>
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
          <span key={l} onClick={() => setPct(p)} className="tap" style={{ flex: 1, textAlign: 'center', fontSize: '13px', fontWeight: 700, color: C.muted, ...C.glassSoft, padding: '11px', borderRadius: '999px', cursor: 'pointer' }}>{l}</span>
        ))}
      </div>

      {/* memo: standard input metrics (54px pill, 15px type) like every other field */}
      <input
        value={s.memo}
        onChange={(e) => store.setSend({ ...s, memo: (e.target as HTMLInputElement).value.slice(0, 28) })}
        placeholder={t('send.memo')}
        style={{ ...C.glass, ...inputStyle, marginBottom: '12px' }}
      />

      <div style={{ flex: 1, minHeight: '12px' }} />
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
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 24px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('confirm.title')} onBack={() => store.setScreen('send')} />
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '20px 0 8px' }}>
        <AssetLogo code={code} size={64} />
      </div>
      <div style={{ textAlign: 'center', fontSize: '30px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '4px' }}>{normalized} {code}</div>
      <div style={{ textAlign: 'center', fontSize: '14px', color: C.dim, fontWeight: 600, marginBottom: '26px' }}>{price > 0 ? `≈ $${fmt(amt * price, 2)}` : ' '}</div>

      {/* flexShrink 0: don't let the details card compress inside the scroll column. */}
      <div style={{ ...C.glass, borderRadius: '18px', padding: '6px 18px', flexShrink: 0 }}>
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

      <div style={{ flex: 1, minHeight: '14px' }} />
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
// Auto-quote cadence: re-price this long after the last input change (debounce),
// and refresh on this interval so a sitting quote stays fresh. Each quote is a real
// Horizon path search, so we don't poll every second — drop QUOTE_REFRESH_MS to 1000
// if you want literal 1s refresh. The executed swap re-prices server-side regardless.
const QUOTE_DEBOUNCE_MS = 500;
const QUOTE_REFRESH_MS = 10000;

/**
 * Swap any trustlined asset for another via CosmosPay (preferential rate per the
 * org plan). The gateway builds the transaction (XDR), we sign it locally with the
 * wallet secret, and the gateway submits it — the wallet stays non-custodial.
 * Requires a provisioned/linked CosmosPay account.
 */
export function Swap({ store }: { store: WalletStore }) {
  const t = store.t;
  // Both sides can be any trustlined asset (XLM always present).
  const assets = sendableAssets(store);
  const firstDest = assets.find((a) => !a.isNative && a.code !== 'XLM');

  const [fromCode, setFromCode] = useState('XLM');
  const [toCode, setToCode] = useState(firstDest?.code ?? 'USDC');
  const [pay, setPay] = useState('1');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  // Which token dropdown is open. The glass cards each create a backdrop-filter stacking
  // context, so an open menu would be painted under the sibling card / quote below it.
  // We lift the active card (and the whole stack) above the rest while a menu is open.
  const [openSel, setOpenSel] = useState<null | 'from' | 'to'>(null);

  const from = assets.find((a) => a.code === fromCode);
  const to = assets.find((a) => a.code === toCode);
  const fromBal = parseFloat(from?.balance ?? '0') || 0;
  const payNum = parseFloat(pay) || 0;
  // "Enabled" for swapping means we have a CosmosPay key for the wallet's CURRENT network
  // (testnet -> dev, mainnet -> prod). If the account exists but lacks this network's key
  // (e.g. an older single-key account), the link card shows so the user can mint both.
  const enabled = !!store.cosmosPay?.keys[networkEnv(store.network)];
  const sameAsset = fromCode === toCode;
  // Spendable amount of the source asset — XLM keeps the account's minimum reserve free,
  // so the swap (which sends the gross amount) can't exceed it. Prevents op_underfunded.
  const availFrom = from ? (from.isNative ? spendableXlm(store) : parseFloat(from.balance) || 0) : 0;
  const insufficient = payNum > 0 && payNum > availFrom;
  const canSwap = enabled && payNum > 0 && !sameAsset && !!from && !!to && !insufficient;

  // The receive amount comes straight from the gateway quote — no CoinGecko/market
  // approximation here, so what's shown is exactly what the swap routes.
  const receive = quote ? parseFloat(quote.destination.estimated) || 0 : 0;
  // Commission rate the user is actually charged (bps -> %), shown for transparency.
  const feePct = quote ? quote.fee.bps / 100 : null;
  // Effective rate the user actually gets (fee included): dest estimated per 1 unit paid.
  const rate = quote && payNum > 0 ? (parseFloat(quote.destination.estimated) || 0) / payNum : null;

  const asSwapAsset = (b: { code: string; issuer: string | null }) => ({ code: b.code, issuer: b.issuer });

  // Clear a stale quote the instant the amount or either asset changes.
  useEffect(() => {
    setQuote(null);
  }, [pay, fromCode, toCode]);

  // Auto-quote: re-price shortly after any change (debounced) and refresh on an
  // interval, so the shown cost stays coherent — no manual "get quote" step. The
  // executed swap re-prices server-side on submit and enforces destMin, so the user
  // is protected even if the displayed quote is a few seconds old.
  useEffect(() => {
    const amt = parseFloat(pay) || 0;
    const f = assets.find((a) => a.code === fromCode);
    const tt = assets.find((a) => a.code === toCode);
    if (!enabled || amt <= 0 || !f || !tt || f.code === tt.code) return;
    let cancelled = false;
    const run = async () => {
      setQuoting(true);
      const q = await store.quoteSwap(pay, { code: f.code, issuer: f.issuer }, { code: tt.code, issuer: tt.issuer });
      if (cancelled) return;
      setQuoting(false);
      if (q) setQuote(q);
    };
    const debounce = setTimeout(run, QUOTE_DEBOUNCE_MS);
    const refresh = setInterval(run, QUOTE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay, fromCode, toCode, enabled, store.account]);

  // Swap the two sides (and any quote, which no longer applies).
  const invert = () => {
    setFromCode(toCode);
    setToCode(fromCode);
    setQuote(null);
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 104px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('swap.title')} onBack={() => store.go('home', 'home')} />

      <div style={{ position: 'relative', marginTop: '6px', zIndex: openSel ? 50 : undefined }}>
        <div style={{ position: 'relative', zIndex: openSel === 'from' ? 3 : undefined, ...C.glass, borderRadius: '20px', padding: '18px' }}>
          <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '14px' }}>{t('swap.pay')}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <SwapTokenSelect assets={assets} code={fromCode} onPick={setFromCode} open={openSel === 'from'} onToggle={(n) => setOpenSel(n ? 'from' : null)} />
            <input value={pay} onChange={(e) => setPay((e.target as HTMLInputElement).value)} inputMode="decimal" style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', textAlign: 'right', color: 'var(--text)', fontSize: '28px', fontWeight: 800, outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
          </div>
          <div style={{ marginTop: '10px', color: C.dim, fontSize: '12px', fontWeight: 600 }}>
            {t('swap.balance')}: {trim(fromBal, 4)} {fromCode}
          </div>
        </div>
        {/* Zero-height anchor BETWEEN the cards: the button centres on the exact seam
            (from-card bottom + half the 10px gap) no matter how tall each card is —
            top:50% of the whole wrapper sat visibly too high. */}
        <div style={{ position: 'relative', height: 0, zIndex: 2 }}>
          <button onClick={invert} aria-label="invert" className="tap" style={{ position: 'absolute', left: '50%', top: '5px', transform: 'translate(-50%,-50%)', width: '44px', height: '44px', borderRadius: '50%', ...C.glassSoft, border: '4px solid var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: 'var(--text)', cursor: 'pointer' }}>⇅</button>
        </div>
        <div style={{ position: 'relative', zIndex: openSel === 'to' ? 3 : undefined, ...C.glass, borderRadius: '20px', padding: '18px', marginTop: '10px' }}>
          <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '14px' }}>{t('swap.receiveEst')}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <SwapTokenSelect assets={assets} code={toCode} onPick={setToCode} open={openSel === 'to'} onToggle={(n) => setOpenSel(n ? 'to' : null)} />
            <div style={{ fontSize: '28px', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: quote ? 'var(--text)' : C.dim }}>{quote ? trim(receive, 4) : '—'}</div>
          </div>
          {rate !== null && (
            <div style={{ textAlign: 'right', marginTop: '10px', color: C.dim, fontSize: '12px', fontWeight: 600 }}>
              1 {fromCode} ≈ {trim(rate, rate < 1 ? 6 : 4)} {toCode}
            </div>
          )}
        </div>
      </div>

      {/* Same-asset guard. */}
      {enabled && sameAsset && (
        <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '12.5px', color: C.muted, fontWeight: 600 }}>{t('swap.sameAsset')}</div>
      )}

      {/* Insufficient-balance guard (reserve-aware for XLM). */}
      {enabled && !sameAsset && insufficient && (
        <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '12.5px', color: C.danger, fontWeight: 600 }}>
          {t('swap.insufficient', { avail: trim(availFrom, 4), code: fromCode })}
        </div>
      )}

      {/* Quotes refresh automatically — show a subtle indicator while re-pricing. */}
      {enabled && quoting && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '14px', fontSize: '12px', color: C.dim, fontWeight: 600 }}>
          <Spinner color="var(--dim)" /> {t('swap.quoting')}
        </div>
      )}

      {/* Quote breakdown: commission RATE + amount + min, so the cost is transparent. */}
      {quote && (
        <div style={{ ...C.glass, borderRadius: '16px', padding: '6px 16px', marginTop: '12px' }}>
          {[
            [t('swap.feeRate'), feePct !== null ? `${trim(feePct, 2)}%` : '—'],
            [t('swap.fee'), `${trim(parseFloat(quote.fee.amount) || 0, 4)} ${quote.fee.asset}`],
            [t('swap.receiveEst'), `${trim(parseFloat(quote.destination.estimated) || 0, 4)} ${quote.destination.asset}`],
            [t('swap.minReceived'), `${trim(parseFloat(quote.destination.minimum) || 0, 4)} ${quote.destination.asset}`],
          ].map(([label, val], i, arr) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
              <span style={{ color: C.muted, fontSize: '13px', fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: '13.5px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* When enabled, a short note; otherwise the CosmosPay card below explains the step. */}
      {enabled && (
        <div style={{ ...C.glass, borderRadius: '14px', padding: '14px', marginTop: '12px', fontSize: '12.5px', color: C.muted, fontWeight: 600, lineHeight: 1.55 }}>
          {t('swap.note2')}
        </div>
      )}

      <div style={{ flex: 1, minHeight: '12px' }} />
      {enabled ? (
        <PrimaryButton disabled={store.busy || !canSwap} onClick={() => from && to && store.submitSwap(pay, asSwapAsset(from), asSwapAsset(to))}>
          {store.busy ? <Spinner /> : t('swap.cta')}
        </PrimaryButton>
      ) : (
        // Not provisioned/linked yet — route through the same Cosmos account flow as Home
        // (enable → confirm email, or link an existing account via a one-time access code).
        <EnableReceivingCard store={store} />
      )}
    </div>
  );
}

/** Token dropdown for the swap screen — any trustlined asset (XLM always present).
 *  `open`/`onToggle` make it controllable so the parent can lift the card's stacking
 *  context while open (the glass cards' backdrop-filter would otherwise trap the menu
 *  below the sibling card). Uncontrolled (internal state) when those props are omitted. */
function SwapTokenSelect({
  assets,
  code,
  onPick,
  open: openProp,
  onToggle,
}: {
  assets: { code: string; issuer: string | null; balance: string; isNative: boolean }[];
  code: string;
  onPick: (code: string) => void;
  open?: boolean;
  onToggle?: (next: boolean) => void;
}) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp ?? openLocal;
  const setOpen = (next: boolean) => (onToggle ? onToggle(next) : setOpenLocal(next));
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: '8px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', padding: '7px 14px 7px 7px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
        <AssetLogo code={code} size={28} />
        {code}
        <span style={{ fontSize: '9px', opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▼</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
          {/* Opaque menu (not translucent glass): the swap cards create their own
              backdrop-filter stacking contexts, so a see-through menu over them reads
              as mush — a solid --bg surface + shadow keeps every row legible. */}
          <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 31, minWidth: '210px', background: 'var(--bg)', border: '1px solid var(--glass-border)', boxShadow: '0 18px 50px rgba(0,0,0,.5)', borderRadius: '16px', padding: '6px', animation: 'fadeUp .18s ease' }}>
            {assets.map((a) => {
              const on = a.code === code;
              return (
                <div key={a.code + (a.issuer ?? '')} onClick={() => { onPick(a.code); setOpen(false); }} className="tap" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '11px', cursor: 'pointer', background: on ? 'var(--surface)' : 'transparent' }}>
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

/* ----------------------------- HISTORY ------------------------------ */
/** Recent on-chain activity for the active wallet (payments + swaps), from Horizon. */
export function History({ store }: { store: WalletStore }) {
  const t = store.t;
  // Refresh whenever the screen opens (or the active wallet / network changes).
  useEffect(() => {
    store.loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.meta?.id, store.network.id]);
  const items = store.history;
  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 104px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('history.title')} onBack={() => store.go('home', 'home')} />
      {store.historyLoading && items.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner color="var(--text)" /></div>
      ) : (
        <div style={{ marginTop: '6px' }}>
          {items.map((it, i) => <HistoryRow key={it.id} item={it} store={store} delay={i * 0.03} />)}
          {/* Visual-only marker closing the list: when this wallet started using Cosmos Pay. */}
          <GenesisRow store={store} delay={items.length * 0.03} />
        </div>
      )}
    </div>
  );
}

export function HistoryRow({ item, store, delay = 0 }: { item: HistoryOp; store: WalletStore; delay?: number }) {
  const t = store.t;
  const url = explorerTxUrl(store.network, item.hash);
  const date = new Date(item.createdAt).toLocaleDateString(store.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const icon = item.kind === 'swap' ? '⇅' : item.kind === 'received' || item.kind === 'create' ? '↓' : item.kind === 'sent' ? '↑' : '•';
  const title =
    item.kind === 'sent' ? t('history.sent')
    : item.kind === 'received' ? t('history.received')
    : item.kind === 'swap' ? t('history.swap')
    : item.kind === 'create' ? t('history.created')
    : t('history.other');
  const sub = item.kind === 'swap'
    ? `${trim(parseFloat(item.fromAmount || '0'), 4)} ${item.fromCode} → ${trim(parseFloat(item.amount || '0'), 4)} ${item.code}`
    : item.counterparty ? shortAddr(item.counterparty) : '';
  const sign = item.kind === 'sent' ? '−' : item.kind === 'received' || item.kind === 'create' ? '+' : '';
  const amountText = item.kind === 'swap'
    ? `+${trim(parseFloat(item.amount || '0'), 4)} ${item.code}`
    : item.amount ? `${sign}${trim(parseFloat(item.amount), 4)} ${item.code}` : '';
  const amountColor = item.failed ? C.danger : sign === '+' || item.kind === 'swap' ? 'var(--up)' : 'var(--text)';
  // Left icon tinted by direction for at-a-glance scanning: green = money in,
  // red = money out, plain white = no value transfer (swaps, signatures, config…).
  const inbound = item.kind === 'received' || item.kind === 'create';
  const iconColor = inbound ? 'var(--up)' : item.kind === 'sent' ? 'var(--down)' : 'var(--text)';
  const iconTint = inbound
    ? { background: 'color-mix(in srgb, var(--up) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--up) 30%, transparent)' }
    : item.kind === 'sent'
      ? { background: 'color-mix(in srgb, var(--down) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--down) 30%, transparent)' }
      : {};
  const Wrapper: any = url ? 'a' : 'div';
  return (
    <Wrapper
      {...(url ? { href: url, target: '_blank', rel: 'noreferrer' } : {})}
      className="tap"
      style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 12px', borderRadius: '16px', textDecoration: 'none', color: 'inherit', animation: 'fadeUp .45s ease backwards', animationDelay: `${delay}s` }}
    >
      <div style={{ width: '38px', height: '38px', borderRadius: '50%', ...C.glassSoft, ...iconTint, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', flexShrink: 0, opacity: item.failed ? 0.6 : 1 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14.5px', fontWeight: 800 }}>
          {title}{item.failed && <span style={{ color: C.danger, fontWeight: 700 }}> · {t('history.failed')}</span>}
        </div>
        {sub && <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {amountText && <div style={{ fontSize: '14px', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: amountColor, textDecoration: item.failed ? 'line-through' : 'none' }}>{amountText}</div>}
        <div style={{ fontSize: '11px', color: C.dim, fontWeight: 600 }}>{date}</div>
      </div>
    </Wrapper>
  );
}

/** Visual-only history marker: when this wallet started using Cosmos Pay. Shown
 *  instead of an empty-history box and as the closing row of the full history. */
export function GenesisRow({ store, delay = 0 }: { store: WalletStore; delay?: number }) {
  const date = store.meta?.createdAt
    ? new Date(store.meta.createdAt).toLocaleDateString(store.locale, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 12px', borderRadius: '16px', animation: 'fadeUp .45s ease backwards', animationDelay: `${delay}s` }}>
      <div style={{ width: '38px', height: '38px', borderRadius: '50%', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Logo size={19} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14.5px', fontWeight: 800 }}>{store.t('history.genesis')}</div>
        <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600 }}>Cosmos Pay</div>
      </div>
      {/* no amount here — a heart takes its place */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: '15px', lineHeight: 1.2 }}>❤️</div>
        <div style={{ fontSize: '11px', color: C.dim, fontWeight: 600 }}>{date}</div>
      </div>
    </div>
  );
}

/* ----------------------------- PAY LINK ----------------------------- */
/** Create a shareable CosmosPay pay link (SEP-7 pay request) to send to a friend. */
export function PayLink({ store }: { store: WalletStore }) {
  const t = store.t;
  const assets = sendableAssets(store);
  const [code, setCode] = useState('XLM');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState('');
  const [intent, setIntent] = useState<PayIntent | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const asset = assets.find((a) => a.code === code);

  const generate = async () => {
    setLoading(true);
    const res = await store.createPayLink({
      amount: amount.trim() || undefined,
      assetCode: code === 'XLM' ? undefined : code,
      assetIssuer: asset && !asset.isNative ? asset.issuer ?? undefined : undefined,
      msg: msg.trim() || undefined,
    });
    setLoading(false);
    if (res) setIntent(res);
  };

  const share = async () => {
    if (!intent) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ text: intent.uri });
        return;
      }
    } catch {
      /* fall back to copy */
    }
    await copyText(intent.uri);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="scr" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '2px 20px 104px', animation: 'fadeUp .3s ease' }}>
      <BackBar title={t('paylink.title')} onBack={() => (intent ? setIntent(null) : store.setScreen('receive'))} />
      {!intent ? (
        <>
          <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, margin: '4px 2px 14px' }}>{t('paylink.desc')}</div>
          <div style={{ ...C.glass, borderRadius: '18px', padding: '18px' }}>
            <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, marginBottom: '14px' }}>{t('paylink.amount')}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <SwapTokenSelect assets={assets} code={code} onPick={setCode} />
              <input value={amount} onChange={(e) => setAmount((e.target as HTMLInputElement).value)} inputMode="decimal" placeholder="0" style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', textAlign: 'right', color: 'var(--text)', fontSize: '28px', fontWeight: 800, outline: 'none', fontVariantNumeric: 'tabular-nums' }} />
            </div>
          </div>
          <input value={msg} onChange={(e) => setMsg((e.target as HTMLInputElement).value.slice(0, 28))} placeholder={t('paylink.msgPlaceholder')} style={{ ...inputStyle, background: C.cardSolid, border: '1px solid var(--glass-border)', marginTop: '12px' }} />
          <div style={{ flex: 1, minHeight: '14px' }} />
          <PrimaryButton disabled={loading} onClick={generate}>{loading ? <Spinner /> : t('paylink.cta')}</PrimaryButton>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', marginTop: '8px' }}>
          <img src={intent.qr} alt="" style={{ width: '230px', height: '230px', borderRadius: '20px', background: '#fff', padding: '10px' }} />
          <div style={{ fontSize: '20px', fontWeight: 800 }}>
            {intent.amount ? `${trim(parseFloat(intent.amount), 4)} ${intent.asset === 'native' ? 'XLM' : intent.asset}` : t('paylink.anyAmount')}
          </div>
          {intent.msg && <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600 }}>{intent.msg}</div>}
          <div style={{ ...C.glassSoft, borderRadius: '14px', padding: '12px 14px', fontSize: '11.5px', color: C.muted, fontWeight: 600, wordBreak: 'break-all', width: '100%', textAlign: 'center' }}>{intent.uri}</div>
          <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
            <GhostButton onClick={() => setIntent(null)} style={{ flex: 1 }}>{t('paylink.another')}</GhostButton>
            <PrimaryButton onClick={share} style={{ flex: 1 }}>{copied ? t('common.copied') : t('paylink.share')}</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
