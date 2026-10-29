import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { readText } from '@/lib/clipboard';
import { fmt, trim } from '@/lib/format';
import { fromMinorUnits, sanitizeDecimalInput, toMinorUnitsBig } from '@/lib/amount';
import { isChainAddress } from '@/lib/chainSwap';
import { isNetworkAddress } from '@/lib/networkSend';
import { networkDefOn, sendFeeReserveOn } from '@/lib/testnets';
import { AmountInput, AmountMeta, FieldNote, RecipientInput, SendSection, useFieldId } from '@/features/money/SendParts';
import { CHAIN_TOKENS_BY_NET, NATIVE_RESERVE } from '@/constants/chains';
import { NETWORKS, type NetworkId, type NetworkToken } from '@/constants/networks';
import '@/styles/features/money/send.css';

/**
 * Send the coin or a stablecoin from the wallet's own address on any network it signs on besides
 * Stellar — Solana, Monad, every EVM network, Fogo (`features/money/Send.tsx`, which picks the
 * asset). The same recipient and amount fields as Stellar's (SendParts). Solana and Monad follow
 * the Stellar network (`store.chainNet`: a test Stellar network sends on Solana devnet and Monad
 * testnet); the others on the network as it is in that mode (`networkDefOn`: a test network's
 * coin only).
 */
export function ChainSendForm({ store, chain, asset }: { store: WalletStore; chain: Exclude<NetworkId, 'stellar'>; asset: string }) {
  const t = store.t;
  const net = store.chainNet;
  const legacy = chain === 'solana' || chain === 'monad';
  const def = networkDefOn(chain, net) ?? NETWORKS[chain];
  const tokens: readonly NetworkToken[] = legacy
    ? CHAIN_TOKENS_BY_NET[net][chain]
    : [{ symbol: def.coin, asset: 'native', decimals: def.decimals }, ...def.tokens];
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [balances, setBalances] = useState<Record<string, bigint> | null | undefined>(undefined);
  const owner = store.addressOn(chain);
  const { chainBalances, networkBalances } = store;
  const toId = useFieldId('to');
  const amountId = useFieldId('amount');

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    setBalances(undefined);
    (legacy ? chainBalances(chain) : networkBalances(chain)).then((b) => {
      if (!cancelled) setBalances(b);
    });
    return () => {
      cancelled = true;
    };
  }, [chain, owner, legacy, chainBalances, networkBalances]);
  // Another asset of the same network: the amount was in the old one's units.
  useEffect(() => setAmount(''), [asset]);

  const token = tokens.find((tk) => tk.asset === asset) ?? tokens[0];
  const native = tokens[0];
  const balance = balances?.[token.asset] ?? 0n;
  const nativeBalance = balances?.[native.asset] ?? 0n;
  // Native: keep the fee reserve. A token: its transfer is paid in the native coin.
  const reserve = legacy ? NATIVE_RESERVE[chain] : sendFeeReserveOn(chain, net);
  const avail = token.asset === 'native' ? (balance > reserve ? balance - reserve : 0n) : balance;
  const noGas = token.asset !== 'native' && nativeBalance < reserve;
  const units = toMinorUnitsBig(amount, token.decimals);
  const human = (v: bigint, decimals: number) => trim(parseFloat(fromMinorUnits(v, decimals) ?? '0') || 0, 6);

  const addrValid = legacy ? isChainAddress(chain, to.trim()) : isNetworkAddress(chain, to.trim());
  const self = !!owner && (def.address === 'evm' ? to.trim().toLowerCase() === owner.toLowerCase() : to.trim() === owner);
  const tooMuch = !!units && units > avail;
  const ready = !!owner && addrValid && !self && !!units && units > 0n && !tooMuch && !noGas && !store.busy;
  const price = store.prices[token.symbol]?.usd ?? 0;
  const amt = parseFloat(amount) || 0;

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
      {!owner && <Notice tone="danger">{t('xswap.noAddress', { chain: store.networkName(chain) })}</Notice>}
      {owner && balances === null && <Notice tone="danger">{t('chains.unreachable')}</Notice>}

      <SendSection label={t('send.to')} htmlFor={toId}>
        <RecipientInput
          id={toId}
          value={to}
          onChange={setTo}
          placeholder={legacy ? t(`chainSend.dest.${chain}`) : t('chainSend.destOn', { network: store.networkName(chain) })}
          onPaste={() => void paste()}
          pasteLabel={t('send.paste')}
          scanLabel={t('scan.scanQr')}
        />
        {to.trim() && (
          <FieldNote tone={addrValid && !self ? 'ok' : 'bad'}>
            {!addrValid ? t('chainSend.invalidAddr') : self ? t('chainSend.selfAddr') : t('send.validAddr')}
          </FieldNote>
        )}
      </SendSection>

      <SendSection label={t('chainSend.amount')} htmlFor={amountId}>
        <AmountInput
          id={amountId}
          value={amount}
          onChange={editAmount}
          code={token.symbol}
          onMax={setMax}
          maxLabel={t('chainSend.max')}
          maxDisabled={!avail}
          invalid={tooMuch}
        />
        <AmountMeta
          worth={price > 0 && amt > 0 ? `≈ $${fmt(amt * price, 2)}` : null}
          available={`${t('send.available')}: ${balances === undefined && owner ? '…' : human(avail, token.decimals)} ${token.symbol}`}
        />
        {tooMuch && <FieldNote tone="bad">{t('chainSend.tooMuch')}</FieldNote>}
        {noGas && balances && <FieldNote tone="bad">{t('chainSend.noGas', { code: native.symbol })}</FieldNote>}
      </SendSection>

      <div className="send-foot kb-dock">
        <PrimaryButton disabled={!ready} onClick={() => void store.submitNetworkSend(chain, token, to, amount)}>
          {store.busy ? <Spinner /> : t('chainSend.submit', { code: token.symbol })}
        </PrimaryButton>
      </div>
    </>
  );
}
