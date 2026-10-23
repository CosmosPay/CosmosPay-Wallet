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
import { CHAIN_TOKENS_BY_NET, NATIVE_RESERVE, OTHER_CHAINS, isEvmChain, type OtherChain } from '@/constants/chains';
import { chainAddressOf } from '@/lib/chainAddressBook';
import { NetworkPicker } from '@/features/money/NetworkPicker';
import { AssetLogo } from '@/ui/AssetLogo';
import { Icon } from '@/ui/Icon';
import '@/styles/features/money/chain-send.css';

/**
 * Send BTC / ETH / SOL / MON and the stablecoins from the phrase's own address on any of the
 * other chains. The network follows the Stellar one (`store.chainNet`): a test Stellar
 * network sends on the chains' test networks (testnet4, Sepolia, devnet…), mainnet on
 * mainnet. Reached from a holding on Home or an account on the Wallet tab.
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
  const owner = chainAddressOf(store.meta?.chainAddresses, chain, net);
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

  const addrValid = isChainAddress(chain, to.trim(), net);
  // EIP-55 and bech32 spell one address in more than one case.
  const caseFree = isEvmChain(chain) || chain === 'bitcoin';
  const self = !!owner && (caseFree ? to.trim().toLowerCase() === owner.toLowerCase() : to.trim() === owner);
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

      <NetworkPicker store={store} value={chain} options={OTHER_CHAINS} onPick={(c) => c !== 'stellar' && setChain(c)} />

      {!owner && <div className="chain-send-guard">{t('xswap.noAddress', { chain: t(`xswap.chain.${chain}`) })}</div>}
      {owner && balances === null && <div className="chain-send-guard">{t('chains.unreachable')}</div>}

      <div className="label-up chain-send-label">{t('chainSend.token')}</div>
      <div className="chip-row">
        {tokens.map((tk) => (
          <button key={tk.asset} type="button" className={cx('chip', token.asset === tk.asset && 'is-on')} onClick={() => setAsset(tk.asset)}>
            <AssetLogo code={tk.symbol} size={20} />
            {tk.symbol}
          </button>
        ))}
      </div>

      <div className="label-up chain-send-label">{t('chainSend.to')}</div>
      <div className="flexr g8">
        <input
          value={to}
          onChange={(e) => setTo((e.target as HTMLInputElement).value)}
          placeholder={t('chainSend.destAny', { chain: t(`chains.net.${net}.${chain}`) })}
          className="input f1 min0"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button onClick={paste} className="glass-soft chain-send-paste">{t('chainSend.paste')}</button>
      </div>
      {to.trim() && (
        <div className={cx('chain-send-note', addrValid && !self ? 'is-valid' : 'is-invalid')}>
          {addrValid && !self && <Icon name="check" size={14} />}
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
