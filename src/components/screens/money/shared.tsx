import { useState } from 'react';
import type { WalletStore } from '@/components/store';
import { C, AssetLogo, Logo } from '@/components/parts';
import { trim, shortAddr } from '@/lib/format';
import { explorerTxUrl, type HistoryOp } from '@/lib/stellar';

export function spendableXlm(store: WalletStore): number {
  const acc = store.account;
  if (!acc || !acc.exists) return 0;
  const minBalance = (2 + acc.subentryCount) * 0.5; // base reserve
  return Math.max(0, acc.xlm - minBalance - 0.001);
}

/** Assets the wallet can send: native XLM (always present) + any trustline balances. */
export function sendableAssets(store: WalletStore) {
  const list = (store.account?.balances ?? []).slice();
  // XLM is the native asset — it never depends on a trustline, so it's always available.
  if (!list.some((b) => b.isNative || b.code === 'XLM')) {
    list.unshift({ code: 'XLM', issuer: null, balance: String(store.account?.xlm ?? 0), isNative: true });
  }
  return list.sort((a, b) => (a.isNative ? -1 : b.isNative ? 1 : 0));
}

/** Token dropdown for the swap screen — any trustlined asset (XLM always present).
 *  `open`/`onToggle` make it controllable so the parent can lift the card's stacking
 *  context while open (the glass cards' backdrop-filter would otherwise trap the menu
 *  below the sibling card). Uncontrolled (internal state) when those props are omitted. */
export function SwapTokenSelect({
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
      <button onClick={() => setOpen(!open)} className="glass-soft" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text)', border: 'none', borderRadius: '999px', padding: '7px 14px 7px 7px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
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
      <div className="glass-soft" style={{ width: '38px', height: '38px', borderRadius: '50%', ...iconTint, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', flexShrink: 0, opacity: item.failed ? 0.6 : 1 }}>{icon}</div>
      <div className="f1 min0">
        <div style={{ fontSize: '14.5px', fontWeight: 800 }}>
          {title}{item.failed && <span style={{ color: C.danger, fontWeight: 700 }}> · {t('history.failed')}</span>}
        </div>
        {sub && <div style={{ fontSize: '12px', color: C.dim, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      <div className="t-right shrink0">
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
      <div className="glass-soft" style={{ width: '38px', height: '38px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Logo size={19} />
      </div>
      <div className="f1 min0">
        <div style={{ fontSize: '14.5px', fontWeight: 800 }}>{store.t('history.genesis')}</div>
        <div className="t-dim-12">Cosmos Pay</div>
      </div>
      {/* no amount here — a heart takes its place */}
      <div className="t-right shrink0">
        <div style={{ fontSize: '15px', lineHeight: 1.2 }}>❤️</div>
        <div style={{ fontSize: '11px', color: C.dim, fontWeight: 600 }}>{date}</div>
      </div>
    </div>
  );
}
