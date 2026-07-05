import type { WalletStore } from '@/components/store';
import { PrimaryButton, BackBar } from '@/components/parts';
import { readText } from '@/lib/clipboard';
import { fmt, trim } from '@/lib/format';
import { isValidPublicKey } from '@/lib/wallet';
import { AssetPicker } from '@/components/molecules/money/AssetPicker';
import { spendableXlm } from './shared';
import '@/styles/screens/money/send.css';

/* ------------------------------- SEND ------------------------------- */
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
        <div className={addrValid ? 'send-addr-note is-valid' : 'send-addr-note is-invalid'}>
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
            style={{ width: `${Math.max(1, s.amount.length || 1)}ch` }}
          />
          <AssetPicker store={store} />
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

      {/* memo: standard input metrics (54px pill, 15px type) like every other field */}
      <input
        value={s.memo}
        onChange={(e) => store.setSend({ ...s, memo: (e.target as HTMLInputElement).value.slice(0, 28) })}
        placeholder={t('send.memo')}
        className="input send-memo"
      />

      <div className="send-spacer" />
      <PrimaryButton disabled={!ok} onClick={() => store.setScreen('confirm')}>
        {amt > avail && amt > 0 ? t('send.insufficient') : t('common.continue')}
      </PrimaryButton>
    </div>
  );
}
