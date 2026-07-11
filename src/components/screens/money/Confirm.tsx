import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar, Spinner, AssetLogo } from '@/components/parts';
import { fmt, shortAddr } from '@/lib/format';
import { normalizeAmount } from '@/lib/stellar';
import '@/styles/screens/money/confirm.css';

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
      <div className="center confirm-logo">
        <AssetLogo code={code} size={64} />
      </div>
      <div className="confirm-amount">{normalized} {code}</div>
      <div className="confirm-fiat">{price > 0 ? `≈ $${fmt(amt * price, 2)}` : ' '}</div>

      {/* flex-shrink 0: don't let the details card compress inside the scroll column. */}
      <div className="glass confirm-card">
        {rows.map((r, i) => (
          <div key={i} className="confirm-row">
            <span className="confirm-row-label">{r[0]}</span>
            <div className="confirm-row-right">
              <div className={r[1].includes('…') ? 'confirm-row-val is-mono' : 'confirm-row-val'}>{r[1]}</div>
              {r[2] && <div className="t-dim-12">{r[2]}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="confirm-spacer" />
      <PrimaryButton disabled={store.busy} onClick={() => store.submitSend()}>
        {store.busy ? <Spinner /> : t('confirm.cta')}
      </PrimaryButton>
    </div>
  );
}
