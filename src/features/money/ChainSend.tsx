import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { readText } from '@/lib/clipboard';
import { trim } from '@/lib/format';
import { cx } from '@/lib/cx';
import { fromMinorUnits, sanitizeDecimalInput, toMinorUnitsBig } from '@/lib/amount';
import { isChainAddress } from '@/lib/chainSwap';
import { CHAIN_TOKENS_BY_NET, NATIVE_RESERVE, OTHER_CHAINS, type OtherChain } from '@/constants/chains';
import '@/styles/features/money/chain-send.css';

/**
 * Send SOL / MON / USDC from the phrase's own address on Solana or Monad. The network
 * follows the Stellar one (`store.chainNet`): a test Stellar network sends on Solana devnet
 * and Monad testnet, mainnet on mainnet. Reached from a Solana / Monad holding on Home.
 */
export function ChainSend({ store }: { store: WalletStore }) {
  const t = store.t;
  const net = store.chainNet;
  const [chain, setChain] = useState<OtherChain>(store.chainAsset.chain);
  const tokens = CHAIN_TOKENS_BY_NET[net][chain];
  const [asset, setAsset] = useState(store.chainAsset.asset);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [balances, setBalances] = useState<Record<string, bigint> | null | undefined>(undefined);
  const owner = store.meta?.chainAddresses?.[chain] ?? null;
  const { ensureChainAddresses, chainBalances } = store;

  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  // A different chain or network is a different token list: start from its native coin,
  // unless the token already chosen (the one Home opened) is on it.
  useEffect(() => {
    const list = CHAIN_TOKENS_BY_NET[net][chain];
    setAsset((a) => (list.some((tk) => tk.asset === a) ? a : list[0].asset));
    setTo('');
    setAmount('');
  }, [chain, net]);

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    setBalances(undefined);
    chainBalances(chain).then((b) => {
      if (!cancelled) setBalances(b);
    });
    return () => {
      cancelled = true;
    };
  }, [chain, owner, chainBalances]);

  const token = tokens.find((tk) => tk.asset === asset) ?? tokens[0];
  const native = tokens[0];
  const balance = balances?.[token.asset] ?? 0n;
  const nativeBalance = balances?.[native.asset] ?? 0n;
  // Native: keep the fee reserve. A token: its transfer is paid in the native coin.
  const avail = token.asset === 'native' ? (balance > NATIVE_RESERVE[chain] ? balance - NATIVE_RESERVE[chain] : 0n) : balance;
  const noGas = token.asset !== 'native' && nativeBalance < NATIVE_RESERVE[chain];
  const units = toMinorUnitsBig(amount, token.decimals);
  const human = (v: bigint, decimals: number) => trim(parseFloat(fromMinorUnits(v, decimals) ?? '0') || 0, 6);

  const addrValid = isChainAddress(chain, to.trim());
  const self = !!owner && (chain === 'monad' ? to.trim().toLowerCase() === owner.toLowerCase() : to.trim() === owner);
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
    <div className="scr screen col pb-24">
      <BackBar title={t('chainSend.title')} onBack={store.goBack} />

      <div className="chain-send-tabs">
        {OTHER_CHAINS.map((c) => (
          <button key={c} className={cx('chain-send-tab', chain === c && 'is-on')} onClick={() => setChain(c)}>
            {t(`chains.net.${net}.${c}`)}
          </button>
        ))}
      </div>

      {!owner && <div className="chain-send-guard">{t('xswap.noAddress', { chain: t(`xswap.chain.${chain}`) })}</div>}
      {owner && balances === null && <div className="chain-send-guard">{t('chains.unreachable')}</div>}

      <div className="label-up chain-send-label">{t('chainSend.token')}</div>
      <div className="chain-send-tabs">
        {tokens.map((tk) => (
          <button key={tk.asset} className={cx('chain-send-tab', token.asset === tk.asset && 'is-on')} onClick={() => setAsset(tk.asset)}>
            {tk.symbol}
          </button>
        ))}
      </div>

      <div className="label-up chain-send-label">{t('chainSend.to')}</div>
      <div className="flexr g8">
        <input
          value={to}
          onChange={(e) => setTo((e.target as HTMLInputElement).value)}
          placeholder={t(`chainSend.dest.${chain}`)}
          className="input f1 min0"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button onClick={paste} className="glass-soft chain-send-paste">{t('chainSend.paste')}</button>
      </div>
      {to.trim() && (
        <div className={cx('chain-send-note', addrValid && !self ? 'is-valid' : 'is-invalid')}>
          {!addrValid ? t('chainSend.invalidAddr') : self ? t('chainSend.selfAddr') : t('send.validAddr')}
        </div>
      )}

      <div className="label-up chain-send-label">{t('chainSend.amount')}</div>
      <div className="flexr g8">
        <input
          value={amount}
          onChange={(e) => editAmount((e.target as HTMLInputElement).value)}
          inputMode="decimal"
          placeholder="0"
          className="input f1 min0"
        />
        <button onClick={setMax} disabled={!avail} className="glass-soft chain-send-paste">{t('chainSend.max')}</button>
      </div>
      <div className="chain-send-balance">
        {t('swap.balance')}: {balances === undefined && owner ? '…' : human(balance, token.decimals)} {token.symbol}
      </div>
      {tooMuch && <div className="chain-send-note is-invalid">{t('chainSend.tooMuch')}</div>}
      {noGas && balances && (
        <div className="chain-send-note is-invalid">{t('chainSend.noGas', { code: native.symbol })}</div>
      )}

      <div className="spacer" />
      <PrimaryButton
        disabled={!ready}
        onClick={() => store.submitChainSend(chain, token, to, amount)}
      >
        {store.busy ? <Spinner /> : t('chainSend.submit', { code: token.symbol })}
      </PrimaryButton>
    </div>
  );
}
