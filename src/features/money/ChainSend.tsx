import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { CheckIcon, CloseIcon } from '@/ui/Icons';
import { readText } from '@/lib/clipboard';
import { trim } from '@/lib/format';
import { cx } from '@/lib/cx';
import { fromMinorUnits, sanitizeDecimalInput, toMinorUnitsBig } from '@/lib/amount';
import { isChainAddress } from '@/lib/chainSwap';
import { isNetworkAddress } from '@/lib/networkSend';
import { CHAIN_TOKENS_BY_NET, NATIVE_RESERVE } from '@/constants/chains';
import { NETWORKS, SEND_FEE_RESERVE, type NetworkId, type NetworkToken } from '@/constants/networks';
import '@/styles/ui/field.css';
import '@/styles/features/money/send.css';

/**
 * Send the coin or a stablecoin from the wallet's own address on any network it signs on besides
 * Stellar — Solana, Monad, every EVM network, Fogo (`features/money/Send.tsx`). Solana and Monad
 * follow the Stellar network (`store.chainNet`: a test Stellar network sends on Solana devnet and
 * Monad testnet); the others are mainnet only.
 */
export function ChainSendForm({ store, chain }: { store: WalletStore; chain: Exclude<NetworkId, 'stellar'> }) {
  const t = store.t;
  const net = store.chainNet;
  const legacy = chain === 'solana' || chain === 'monad';
  const def = NETWORKS[chain];
  const tokens: readonly NetworkToken[] = legacy
    ? CHAIN_TOKENS_BY_NET[net][chain]
    : [{ symbol: def.coin, asset: 'native', decimals: def.decimals }, ...def.tokens];
  // The token a Solana / Monad holding opened, when it is on this chain; the native coin else.
  const [asset, setAsset] = useState(() =>
    store.chainAsset.chain === chain && tokens.some((tk) => tk.asset === store.chainAsset.asset) ? store.chainAsset.asset : tokens[0].asset,
  );
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [balances, setBalances] = useState<Record<string, bigint> | null | undefined>(undefined);
  const owner = store.addressOn(chain);
  const { chainBalances, networkBalances } = store;

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    setBalances(undefined);
    (chain === 'solana' || chain === 'monad' ? chainBalances(chain) : networkBalances(chain)).then((b) => {
      if (!cancelled) setBalances(b);
    });
    return () => {
      cancelled = true;
    };
  }, [chain, owner, chainBalances, networkBalances]);

  const token = tokens.find((tk) => tk.asset === asset) ?? tokens[0];
  const native = tokens[0];
  const balance = balances?.[token.asset] ?? 0n;
  const nativeBalance = balances?.[native.asset] ?? 0n;
  // Native: keep the fee reserve. A token: its transfer is paid in the native coin.
  const reserve = chain === 'solana' || chain === 'monad' ? NATIVE_RESERVE[chain] : SEND_FEE_RESERVE[chain] ?? 0n;
  const avail = token.asset === 'native' ? (balance > reserve ? balance - reserve : 0n) : balance;
  const noGas = token.asset !== 'native' && nativeBalance < reserve;
  const units = toMinorUnitsBig(amount, token.decimals);
  const human = (v: bigint, decimals: number) => trim(parseFloat(fromMinorUnits(v, decimals) ?? '0') || 0, 6);

  const addrValid = chain === 'solana' || chain === 'monad' ? isChainAddress(chain, to.trim()) : isNetworkAddress(chain, to.trim());
  const self = !!owner && (def.address === 'evm' ? to.trim().toLowerCase() === owner.toLowerCase() : to.trim() === owner);
  const tooMuch = !!units && units > avail;
  const ready = !!owner && addrValid && !self && !!units && units > 0n && !tooMuch && !noGas && !store.busy;

  const paste = async () => {
    const txt = (await readText())?.trim();
    if (txt) setTo(txt);
  };
  const editAmount = (raw: string) => {
    const v = sanitizeDecimalInput(raw);
    if (v !== null) setAmount(v);
  };
  const setMax = () => setAmount(fromMinorUnits(avail, token.decimals) ?? '0');

  return (
    <>
      {!owner && <Notice tone="danger">{t('xswap.noAddress', { chain: def.name })}</Notice>}
      {owner && balances === null && <Notice tone="danger">{t('chains.unreachable')}</Notice>}

      <span className="field-label" id={`chain-send-token-${chain}`}>
        {t('chainSend.token')}
      </span>
      <div role="radiogroup" aria-labelledby={`chain-send-token-${chain}`} className="send-tokens">
        {tokens.map((tk) => (
          <button
            key={tk.asset}
            type="button"
            role="radio"
            aria-checked={token.asset === tk.asset}
            onClick={() => setAsset(tk.asset)}
            className={cx('send-token', token.asset === tk.asset && 'is-on')}
          >
            {tk.symbol}
          </button>
        ))}
      </div>

      <label className="field">
        <span className="field-label">{t('chainSend.to')}</span>
        <span className="send-to">
          <input
            value={to}
            onChange={(e) => setTo((e.target as HTMLInputElement).value)}
            placeholder={legacy ? t(`chainSend.dest.${chain}`) : t('chainSend.destOn', { network: def.name })}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="input send-to-input"
          />
          <button type="button" onClick={paste} className="send-side-btn">
            {t('chainSend.paste')}
          </button>
        </span>
      </label>
      {to.trim() && (
        <p className={cx('send-note', addrValid && !self ? 'is-valid' : 'is-invalid')}>
          {addrValid && !self ? <CheckIcon /> : <CloseIcon />}
          {!addrValid ? t('chainSend.invalidAddr') : self ? t('chainSend.selfAddr') : t('send.validAddr')}
        </p>
      )}

      <label className="field">
        <span className="field-label">{t('chainSend.amount')}</span>
        <span className="send-to">
          <input
            value={amount}
            onChange={(e) => editAmount((e.target as HTMLInputElement).value)}
            inputMode="decimal"
            placeholder="0"
            className="input send-to-input"
          />
          <button type="button" onClick={setMax} disabled={!avail} className="send-side-btn">
            {t('chainSend.max')}
          </button>
        </span>
      </label>
      <p className="send-avail is-left">
        {t('swap.balance')}: {balances === undefined && owner ? '…' : human(balance, token.decimals)} {token.symbol}
      </p>
      {tooMuch && <p className="send-note is-invalid">{t('chainSend.tooMuch')}</p>}
      {noGas && balances && <p className="send-note is-invalid">{t('chainSend.noGas', { code: native.symbol })}</p>}

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!ready} onClick={() => void store.submitNetworkSend(chain, token, to, amount)}>
          {store.busy ? <Spinner /> : t('chainSend.submit', { code: token.symbol })}
        </PrimaryButton>
      </div>
    </>
  );
}
