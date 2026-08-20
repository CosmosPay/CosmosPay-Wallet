import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { readText } from '@/lib/clipboard';
import { fmt, trim } from '@/lib/format';
import { isValidPublicKey } from '@/lib/wallet';
import { cx } from '@/lib/cx';
import { AssetSelect } from '@/features/money/AssetSelect';
import { findAsset, isNativeRef } from '@/lib/asset';
import { parseDecimalOr0, sanitizeDecimalInput } from '@/lib/amount';
import { clampMemoText, memoProblem } from '@/lib/memo';
import { spendableXlm, sendableAssets } from '@/lib/balances';
import '@/styles/features/money/send.css';

/* ------------------------------- SEND ------------------------------- */
export function Send({ store }: { store: WalletStore }) {
  const t = store.t;
  const s = store.send;
  const assets = sendableAssets(store.account);
  const code = s.asset.code;
  const isNative = isNativeRef(s.asset);
  // Match the exact (code, issuer) the user picked — not the first row sharing a code.
  const bal = findAsset(assets, s.asset);
  const avail = isNative ? spendableXlm(store.account) : parseDecimalOr0(bal?.balance);
  const price = store.prices[code]?.usd ?? 0;
  const amt = parseDecimalOr0(s.amount);
  const addrValid = isValidPublicKey(s.to);
  const amtValid = amt > 0 && amt <= avail;
  const memoErr = memoProblem(s.memo, s.memoKind);
  const ok = addrValid && amtValid && !memoErr;

  const setPct = (p: number) => store.setSend({ ...s, amount: String(Math.floor(avail * p * 1e7) / 1e7) });
  // Direct keyboard editing (no on-screen pad) through the shared decimal filter.
  const editAmountInput = (raw: string) => {
    const v = sanitizeDecimalInput(raw);
    if (v !== null) store.setSend({ ...s, amount: v });
  };
  const pastePayUrl = async () => {
    const txt = (await readText())?.trim();
    if (txt && store.applySep7(txt)) return;
    store.flash(t('ops.pasteInvalid'), 'err');
  };

  return (
    <div className="scr screen col pb-24">
      <BackBar title={t('send.title')} onBack={store.goBack} />

      <div className="label-up send-to-label">{t('send.to')}</div>
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
          className="input send-addr-input"
        />
        <button onClick={() => store.setScreen('scan')} title={t('scan.scanQr')} className="glass-soft send-scan-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" /><path d="M14 14h3v3M21 14v.01M21 21v-4M14 21h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </div>
      {/* Standard-sized control (48px pill), snug under the address row; the
          validity note only takes space once there's something to validate. */}
      <button onClick={pastePayUrl} className="glass-soft pill-btn send-paste-btn">
        ⛓ {t('ops.pastePay')}
      </button>
      {s.to && (
        <div className={cx('send-addr-note', addrValid ? 'is-valid' : 'is-invalid')}>
          <span className="send-addr-dot">{addrValid ? '✓' : '✕'}</span>
          {addrValid ? t('send.validAddr') : t('send.invalidAddr')}
        </div>
      )}

      <div className="send-amount">
        {/* asset selector sits right next to the amount; the amount is a real input
            (system keyboard) — no on-screen pad needed on any device */}
        <div className="center g12">
          <input
            value={s.amount}
            onChange={(e) => editAmountInput((e.target as HTMLInputElement).value)}
            inputMode="decimal"
            placeholder="0"
            className="send-amount-input"
          />
          <AssetSelect
            variant="send"
            assets={assets}
            value={s.asset}
            onPick={(a) => store.setSend({ ...s, asset: { code: a.code, issuer: a.issuer }, amount: '0' })}
          />
        </div>
        <div className="send-avail">
          {price > 0 ? `≈ $${fmt(amt * price, 2)} · ` : ''}{t('send.available')}: {trim(avail, 4)} {code}
        </div>
      </div>

      <div className="flexr g8 send-pct">
        {([['25%', 0.25], ['50%', 0.5], ['Máx', 1]] as [string, number][]).map(([l, p]) => (
          <span key={l} onClick={() => setPct(p)} className="tap glass-soft send-pct-btn">{l}</span>
        ))}
      </div>

      {/* memo: standard input metrics (54px pill, 15px type) like every other field.
          Clamped by BYTES — Stellar's 28 is a byte limit, so 28 accented characters
          used to build fine here and throw inside the SDK after the password step. */}
      <input
        value={s.memo}
        onChange={(e) => store.setSend({ ...s, memo: clampMemoText((e.target as HTMLInputElement).value) })}
        placeholder={t('send.memo')}
        className="input send-memo"
      />
      {memoErr && <div className="send-memo-err">{memoErr}</div>}

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!ok} onClick={() => store.setScreen('confirm')}>
          {amt > avail && amt > 0 ? t('send.insufficient') : t('common.continue')}
        </PrimaryButton>
      </div>
    </div>
  );
}
