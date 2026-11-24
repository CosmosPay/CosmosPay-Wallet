import type { WalletStore } from '@/state/store';
import { AssetLogo } from '@/ui/AssetLogo';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { shortAddr } from '@/lib/format';
import { normalizeAmount } from '@/lib/stellar';
import { parseDecimalOr0 } from '@/lib/amount';
import { memoToSign } from '@/lib/memo';
import { sendsToSelf } from '@/lib/sendDraft';
import '@/styles/features/money/confirm.css';
import { KVRow } from '@/ui/KVRow';

/* ----------------------------- CONFIRM ------------------------------ */
export function Confirm({ store }: { store: WalletStore }) {
  const t = store.t;
  const num = store.num;
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
    // A payment to the wallet's own address is allowed; the review names it as such too.
    [t('confirm.to'), shortAddr(s.to, 6, 6), sendsToSelf('stellar', s.to, from) ? t('confirm.yourWallet') : undefined],
    [t('confirm.amount'), `${num.decimal(normalized)} ${code}`, price > 0 ? `≈ ${num.usd(amt * price)}` : undefined],
    [t('confirm.network'), `Stellar ${store.network.label}`],
    [t('confirm.fee'), `≈ ${num.decimal('0.00001')} XLM`],
  ];
  // The issuer IS the asset's identity, and this is the last screen before the money
  // leaves: show it for any non-native asset so a look-alike token is visible here.
  if (s.asset.issuer) rows.push([t('confirm.issuer'), shortAddr(s.asset.issuer, 6, 6)]);
  // The memo that will be SIGNED, the wallet's own included when the field is empty: what goes
  // on chain is read here first (the same `memoToSign` the transaction is built with).
  const memo = memoToSign(s.memo, s.memoKind);
  if (memo) rows.push([t('confirm.memo'), memo.kind === 'id' ? `${memo.value} (ID)` : memo.value, memo.isDefault ? t('confirm.memoDefault') : undefined]);

  return (
    <div className="scr screen col pb-24">
      <ScreenHeader title={t('confirm.title')} onBack={store.goBack} />
      <div className="center confirm-logo">
        <AssetLogo code={code} size={64} />
      </div>
      <div className="confirm-amount">{num.decimal(normalized)} {code}</div>
      <div className="confirm-fiat">{price > 0 ? `≈ ${num.usd(amt * price)}` : ' '}</div>

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
