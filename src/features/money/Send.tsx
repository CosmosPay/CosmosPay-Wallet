import { useEffect, useId, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { CheckIcon, CloseIcon, LinkIcon, ScanIcon } from '@/ui/Icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Tabs } from '@/ui/Tabs';
import { readText } from '@/lib/clipboard';
import { fmt, trim } from '@/lib/format';
import { isValidPublicKey } from '@/lib/wallet';
import { cx } from '@/lib/cx';
import { AssetSelect } from '@/features/money/AssetSelect';
import { ChainSendForm } from '@/features/money/ChainSend';
import { findAsset, isNativeRef } from '@/lib/asset';
import { parseDecimalOr0, sanitizeDecimalInput } from '@/lib/amount';
import { clampMemoText, memoProblem } from '@/lib/memo';
import { spendableXlm, sendableAssets } from '@/lib/balances';
import type { CrossChainNetwork } from '@/lib/cosmospay';
import '@/styles/ui/field.css';
import '@/styles/features/money/send.css';

const NETWORKS: readonly CrossChainNetwork[] = ['stellar', 'solana', 'monad'];

/* ------------------------------- SEND ------------------------------- */
/**
 * Send from any network the wallet holds, one tab each: Stellar (any trustline, a memo, a pay
 * link pasted or scanned) and the phrase's own Solana and Monad addresses. Opened from a
 * Solana / Monad holding (the `chain-send` screen) it starts on that network.
 */
export function Send({ store }: { store: WalletStore }) {
  const t = store.t;
  const chains = store.meta?.chainAddresses;
  const [net, setNet] = useState<CrossChainNetwork>(store.screen === 'chain-send' ? store.chainAsset.chain : 'stellar');
  const panelId = useId();
  const { ensureChainAddresses } = store;
  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  return (
    <div className="scr screen col pb-24">
      <ScreenHeader title={t('send.title')} onBack={store.goBack} />
      {chains && (
        <Tabs
          tabs={NETWORKS.map((n) => ({ key: n, label: t(`xswap.chain.${n}`) }))}
          value={net}
          onChange={setNet}
          label={t('receive.network')}
          panelId={panelId}
          className="send-tabs"
        />
      )}
      <div id={panelId} role="tabpanel" className="send-panel">
        {net === 'stellar' ? <StellarSend store={store} /> : <ChainSendForm key={net} store={store} chain={net} />}
      </div>
    </div>
  );
}

/** Send on Stellar: destination, amount in any trustline, memo. The draft lives in the store
 *  (`store.send`), because the confirmation is a screen of its own. */
function StellarSend({ store }: { store: WalletStore }) {
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
    <>
      <label className="field">
        <span className="field-label">{t('send.to')}</span>
        <span className="send-to">
          <input
            value={s.to}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value.trim();
              // Pasting a SEP-7 link fills destination + amount + memo in one go.
              if (v.toLowerCase().startsWith('web+stellar:') && store.applySep7(v)) return;
              store.setSend({ ...s, to: v });
            }}
            placeholder={t('send.dest')}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="input send-to-input"
          />
          <button type="button" onClick={() => store.setScreen('scan')} aria-label={t('scan.scanQr')} className="send-icon-btn">
            <ScanIcon />
          </button>
        </span>
      </label>
      {s.to && (
        <p className={cx('send-note', addrValid ? 'is-valid' : 'is-invalid')}>
          {addrValid ? <CheckIcon /> : <CloseIcon />}
          {addrValid ? t('send.validAddr') : t('send.invalidAddr')}
        </p>
      )}
      <button type="button" onClick={pastePayUrl} className="link-btn send-paste">
        <LinkIcon />
        {t('ops.pastePay')}
      </button>

      <div className="send-amount">
        <input
          value={s.amount}
          onChange={(e) => editAmountInput((e.target as HTMLInputElement).value)}
          inputMode="decimal"
          placeholder="0"
          aria-label={t('chainSend.amount')}
          className="send-amount-input"
        />
        <AssetSelect
          variant="send"
          assets={assets}
          value={s.asset}
          onPick={(a) => store.setSend({ ...s, asset: { code: a.code, issuer: a.issuer }, amount: '0' })}
        />
      </div>
      <p className="send-avail">
        {price > 0 ? `≈ $${fmt(amt * price, 2)} · ` : ''}
        {t('send.available')}: {trim(avail, 4)} {code}
      </p>
      <div className="send-pcts" role="group" aria-label={t('chainSend.amount')}>
        {([['25%', 0.25], ['50%', 0.5], [t('send.max'), 1]] as [string, number][]).map(([l, p]) => (
          <button key={l} type="button" onClick={() => setPct(p)} className="send-pct">
            {l}
          </button>
        ))}
      </div>

      {/* Clamped by BYTES — Stellar's 28 is a byte limit, so 28 accented characters would
          build fine here and throw inside the SDK after the password step. */}
      <label className="field">
        <span className="field-label">{t('send.memo')}</span>
        <input
          value={s.memo}
          onChange={(e) => store.setSend({ ...s, memo: clampMemoText((e.target as HTMLInputElement).value) })}
          className="input"
        />
      </label>
      {memoErr && <p className="send-note is-invalid">{memoErr}</p>}

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!ok} onClick={() => store.setScreen('confirm')}>
          {amt > avail && amt > 0 ? t('send.insufficient') : t('common.continue')}
        </PrimaryButton>
      </div>
    </>
  );
}
