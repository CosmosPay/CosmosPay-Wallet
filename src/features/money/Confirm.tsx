import type { WalletStore } from '@/state/store';
import { AssetLogo } from '@/ui/AssetLogo';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { fmt, shortAddr } from '@/lib/format';
import { normalizeAmount } from '@/lib/stellar';
import { parseDecimalOr0 } from '@/lib/amount';
import '@/styles/features/money/confirm.css';
import { KVRow } from '@/ui/KVRow';

/* ----------------------------- CONFIRM ------------------------------ */
export function Confirm({ store }: { store: WalletStore }) {
  const t = store.t;
  const s = store.send;
  const code = s.asset.code;
  const amt = parseDecimalOr0(s.amount);
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
  // The issuer IS the asset's identity, and this is the last screen before the money
  // leaves: show it for any non-native asset so a look-alike token is visible here.
  if (s.asset.issuer) rows.push([t('confirm.issuer'), shortAddr(s.asset.issuer, 6, 6)]);
  if (s.memo) rows.push([t('confirm.memo'), s.memoKind === 'id' ? `${s.memo} (ID)` : s.memo]);

  return (
    <div className="scr screen col pb-24">
      <BackBar title={t('confirm.title')} onBack={store.goBack} />
      <div className="center confirm-logo">
        <AssetLogo code={code} size={64} />
      </div>
      <div className="confirm-amount">{normalized} {code}</div>
      <div className="confirm-fiat">{price > 0 ? `≈ $${fmt(amt * price, 2)}` : ' '}</div>

      {/* flex-shrink 0: don't let the details card compress inside the scroll column. */}
      <div className="glass kv-card confirm-card">
        {rows.map((r, i) => (
          <KVRow key={i} label={r[0]} value={r[1]} sub={r[2]} mono={r[1].includes('…')} />
        ))}
      </div>

      <div className="spacer" />
      <PrimaryButton disabled={store.busy} onClick={() => store.submitSend()}>
        {store.busy ? <Spinner /> : t('confirm.cta')}
      </PrimaryButton>
    </div>
  );
}
