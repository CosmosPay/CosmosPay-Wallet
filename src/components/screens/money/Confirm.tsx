import type { WalletStore } from '@/components/store';
import { C, PrimaryButton, BackBar, Spinner, AssetLogo } from '@/components/parts';
import { fmt, shortAddr } from '@/lib/format';
import { normalizeAmount } from '@/lib/stellar';

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
    <div className="scr screen col pb-24">
      <BackBar title={t('confirm.title')} onBack={() => store.setScreen('send')} />
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '20px 0 8px' }}>
        <AssetLogo code={code} size={64} />
      </div>
      <div style={{ textAlign: 'center', fontSize: '30px', fontWeight: 800, letterSpacing: '-1px', marginBottom: '4px' }}>{normalized} {code}</div>
      <div style={{ textAlign: 'center', fontSize: '14px', color: C.dim, fontWeight: 600, marginBottom: '26px' }}>{price > 0 ? `≈ $${fmt(amt * price, 2)}` : ' '}</div>

      {/* flexShrink 0: don't let the details card compress inside the scroll column. */}
      <div className="glass" style={{ borderRadius: '18px', padding: '6px 18px', flexShrink: 0 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 0', borderBottom: i < rows.length - 1 ? '1px solid var(--hairline)' : 'none', gap: '12px' }}>
            <span style={{ color: C.muted, fontSize: '14px', fontWeight: 600 }}>{r[0]}</span>
            <div style={{ textAlign: 'right', minWidth: 0 }}>
              <div style={{ fontSize: '14.5px', fontWeight: 700, fontFamily: r[1].includes('…') ? 'monospace' : 'inherit' }}>{r[1]}</div>
              {r[2] && <div className="t-dim-12">{r[2]}</div>}
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
