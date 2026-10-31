import { useEffect, useMemo, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { PlusIcon } from '@/ui/Icons';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { readText } from '@/lib/clipboard';
import { fmt, trim } from '@/lib/format';
import { isValidPublicKey } from '@/lib/wallet';
import { fromMinorUnits, parseDecimalOr0, sanitizeDecimalInput } from '@/lib/amount';
import { findAsset, isNativeRef } from '@/lib/asset';
import { clampMemoText, memoProblem } from '@/lib/memo';
import { spendableXlm, sendableAssets } from '@/lib/balances';
import { ChainSendForm } from '@/features/money/ChainSend';
import { SendAssetPicker, type SendOption } from '@/features/money/SendAssetPicker';
import { AmountInput, AmountMeta, FieldNote, RecipientInput, SendSection, useFieldId } from '@/features/money/SendParts';
import { CHAIN_TOKENS_BY_NET } from '@/constants/chains';
import { networkDefOn, sendsOn } from '@/lib/testnets';
import { NETWORKS, NETWORK_IDS, type NetworkId } from '@/constants/networks';
import '@/styles/features/money/send.css';

/** A pick is `network|asset`: a Stellar asset as `CODE:ISSUER` (XLM `XLM:`), a token by its contract. */
const stellarKey = (a: { code: string; issuer: string | null }) => `stellar|${a.code}:${a.issuer ?? ''}`;
const splitKey = (key: string): { network: NetworkId; asset: string } => {
  const i = key.indexOf('|');
  return { network: key.slice(0, i) as NetworkId, asset: key.slice(i + 1) };
};

/* ------------------------------- SEND ------------------------------- */
/**
 * Send, the way wallets ask it, the same on every network: WHAT (an asset, which brings its
 * network: SendAssetPicker), TO WHOM (one field, paste and scan inside), HOW MUCH (one field,
 * the code and "Max" inside, what it is worth and what is available under it), then review.
 * Stellar adds an optional memo, folded until asked for. Opened from a Solana / Monad holding
 * (the `chain-send` screen) it starts on that asset.
 *
 * The networks offered are the ones the wallet signs on in the mode (`sendsOn`): on mainnet the
 * registry's `send`; in test mode Stellar's, Solana devnet, Monad testnet and every EVM test
 * network and Fogo's, their coin only — never a main network.
 */
export function Send({ store }: { store: WalletStore }) {
  const t = store.t;
  const { ensureChainAddresses, addressOn, chainNet } = store;
  const offered = useMemo(
    () => NETWORK_IDS.filter((id) => sendsOn(id, chainNet) && !!addressOn(id)),
    [addressOn, chainNet],
  );
  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  // Every asset that can be sent, on every network offered, with what is held of it.
  const options = useMemo((): SendOption[] => {
    const out: SendOption[] = [];
    for (const net of offered) {
      const networkName = store.networkName(net);
      if (net === 'stellar') {
        for (const a of sendableAssets(store.account)) {
          const n = parseFloat(a.balance) || 0;
          out.push({ key: stellarKey(a), network: net, networkName, code: a.code, balance: trim(n, 6), held: n > 0 });
        }
        continue;
      }
      const def = networkDefOn(net, chainNet) ?? NETWORKS[net];
      const legacy = net === 'solana' || net === 'monad';
      const tokens = legacy ? CHAIN_TOKENS_BY_NET[chainNet][net] : [{ symbol: def.coin, asset: 'native', decimals: def.decimals }, ...def.tokens];
      const held = legacy ? store.chainHoldings?.[net] : store.networkHoldings?.[net];
      for (const tk of tokens) {
        const units = held ? held[tk.asset] ?? 0n : null;
        const n = units === null ? null : parseFloat(fromMinorUnits(units, tk.decimals) ?? '0') || 0;
        out.push({ key: `${net}|${tk.asset}`, network: net, networkName, code: tk.symbol, balance: n === null ? null : trim(n, 6), held: (n ?? 0) > 0 });
      }
    }
    return out;
  }, [offered, store.account, store.chainHoldings, store.networkHoldings, store.networkName, chainNet]);

  const [pick, setPick] = useState(() =>
    store.screen === 'chain-send' ? `${store.chainAsset.chain}|${store.chainAsset.asset}` : stellarKey(store.send.asset),
  );
  // Stellar's draft lives in the store (a pay link or a scan may set it): it names the asset.
  const picked = splitKey(pick.startsWith('stellar|') ? stellarKey(store.send.asset) : pick);
  const value = picked.network === 'stellar' ? stellarKey(store.send.asset) : pick;

  const choose = (key: string) => {
    const k = splitKey(key);
    if (k.network === 'stellar') {
      const [code, issuer] = [k.asset.slice(0, k.asset.indexOf(':')), k.asset.slice(k.asset.indexOf(':') + 1)];
      store.setSend({ ...store.send, asset: { code, issuer: issuer || null }, amount: '0' });
    }
    setPick(key);
  };

  return (
    <div className="scr screen col pb-24 send">
      <ScreenHeader title={t('send.title')} onBack={store.goBack} />
      <div className="send-form">
        <SendSection label={t('send.asset')}>
          <SendAssetPicker
            options={options}
            value={value}
            onPick={choose}
            labels={{
              title: t('send.pickTitle'),
              search: t('home.searchAssets'),
              clear: t('common.clearSearch'),
              close: t('a11y.close'),
              held: t('send.held'),
              others: t('send.others'),
              none: t('send.noAsset'),
              available: t('swap.balance'),
            }}
          />
        </SendSection>
        {picked.network === 'stellar' ? (
          <StellarSend store={store} />
        ) : (
          <ChainSendForm key={picked.network} store={store} chain={picked.network} asset={picked.asset} />
        )}
      </div>
    </div>
  );
}

/** Send on Stellar: recipient, amount in the picked trustline, an optional memo. The draft lives
 *  in the store (`store.send`), because the confirmation is a screen of its own. */
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
  const tooMuch = amt > avail;
  const memoErr = memoProblem(s.memo, s.memoKind);
  const ok = addrValid && amt > 0 && !tooMuch && !memoErr;
  const [memoOpen, setMemoOpen] = useState(!!s.memo);
  const toId = useFieldId('to');
  const amountId = useFieldId('amount');
  const memoId = useFieldId('memo');

  const setTo = (raw: string) => {
    const v = raw.trim();
    // A SEP-7 link fills recipient, amount and memo in one go.
    if (v.toLowerCase().startsWith('web+stellar:') && store.applySep7(v)) return;
    store.setSend({ ...s, to: v });
  };
  const paste = async () => {
    const txt = (await readText())?.trim();
    if (!txt) return;
    if (txt.toLowerCase().startsWith('web+stellar:')) {
      if (!store.applySep7(txt)) store.flash(t('ops.pasteInvalid'), 'err');
      return;
    }
    store.setSend({ ...s, to: txt });
  };
  const editAmount = (raw: string) => {
    const v = sanitizeDecimalInput(raw);
    if (v !== null) store.setSend({ ...s, amount: v });
  };
  const setMax = () => store.setSend({ ...s, amount: String(Math.floor(avail * 1e7) / 1e7) });

  return (
    <>
      <SendSection label={t('send.to')} htmlFor={toId}>
        <RecipientInput
          id={toId}
          value={s.to}
          onChange={setTo}
          placeholder={t('send.dest')}
          onPaste={() => void paste()}
          onScan={() => store.setScreen('scan')}
          pasteLabel={t('send.paste')}
          scanLabel={t('scan.scanQr')}
        />
        {s.to && <FieldNote tone={addrValid ? 'ok' : 'bad'}>{addrValid ? t('send.validAddr') : t('send.invalidAddr')}</FieldNote>}
      </SendSection>

      <SendSection label={t('chainSend.amount')} htmlFor={amountId}>
        <AmountInput
          id={amountId}
          value={s.amount === '0' ? '' : s.amount}
          onChange={editAmount}
          code={code}
          onMax={setMax}
          maxLabel={t('send.max')}
          maxDisabled={avail <= 0}
          invalid={tooMuch}
        />
        <AmountMeta worth={price > 0 && amt > 0 ? `≈ $${fmt(amt * price, 2)}` : null} available={`${t('send.available')}: ${trim(avail, 4)} ${code}`} />
        {tooMuch && <FieldNote tone="bad">{t('send.insufficient')}</FieldNote>}
      </SendSection>

      {/* Shown once asked for, or once something (a pay link, a scan) wrote one. */}
      {memoOpen || s.memo ? (
        <SendSection label={t('send.memo')} htmlFor={memoId}>
          {/* Clamped by BYTES — Stellar's 28 is a byte limit, so 28 accented characters would
              build fine here and throw inside the SDK after the password step. */}
          <div className="send-box">
            <input
              id={memoId}
              value={s.memo}
              onChange={(e) => store.setSend({ ...s, memo: clampMemoText((e.target as HTMLInputElement).value) })}
              autoComplete="off"
              className="send-box-input"
            />
          </div>
          {memoErr && <FieldNote tone="bad">{memoErr}</FieldNote>}
        </SendSection>
      ) : (
        <button type="button" onClick={() => setMemoOpen(true)} className="link-btn send-add-memo">
          <PlusIcon />
          {t('send.addMemo')}
        </button>
      )}

      <div className="send-foot kb-dock">
        <PrimaryButton disabled={!ok} onClick={() => store.setScreen('confirm')}>
          {t('send.review')}
        </PrimaryButton>
      </div>
    </>
  );
}
