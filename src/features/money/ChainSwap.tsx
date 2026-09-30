import { useEffect, useState, type ReactNode } from 'react';
import type { WalletStore } from '@/state/store';
import { PrimaryButton } from '@/ui/Buttons';
import { Spinner } from '@/ui/Spinner';
import { trim } from '@/lib/format';
import { cx } from '@/lib/cx';
import { CROSS_CHAIN_TARGET_SYMBOLS, QUOTE_DEBOUNCE_MS, QUOTE_REFRESH_MS } from '@/constants/swap';
import { CHAIN_TOKENS, NATIVE_RESERVE, type ChainToken, type OtherChain } from '@/constants/chains';
import type { CrossChainAsset, CrossChainNetwork, CrossChainQuote, SwapQuote } from '@/lib/cosmospay';
import { networkEnv } from '@/lib/stellar';
import { fromMinorUnits, parseDecimalOr0, sanitizeDecimalInput, toMinorUnitsBig } from '@/lib/amount';

const TARGETS: CrossChainNetwork[] = ['stellar', 'solana', 'monad'];

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

/**
 * The swap screen when it pays from Solana or Monad. On the same chain it is a Jupiter
 * (Solana) or Kuru Flow (Monad) swap the gateway builds and the wallet checks and signs;
 * to another chain — Stellar included — it is a NEAR Intents swap the wallet funds with
 * a transfer it builds itself. Either way both ends are this phrase's own addresses.
 *
 * `header` is the "Pay from" selector, owned by `Swap`, which renders this screen.
 */
export function ChainSwap({ store, origin, header }: { store: WalletStore; origin: OtherChain; header: ReactNode }) {
  const t = store.t;
  const tokens = CHAIN_TOKENS[origin];
  const [fromAsset, setFromAsset] = useState(tokens[0].asset);
  const [target, setTarget] = useState<CrossChainNetwork>(origin);
  const [toAsset, setToAsset] = useState(tokens[1].asset);
  const [xDestId, setXDestId] = useState<string | null>(null);
  const [xAssets, setXAssets] = useState<CrossChainAsset[]>([]);
  const [pay, setPay] = useState('');
  const [balances, setBalances] = useState<Record<string, bigint> | null | undefined>(undefined);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [xQuote, setXQuote] = useState<CrossChainQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  // Switching chains resets what only made sense on the previous one.
  useEffect(() => {
    setFromAsset(tokens[0].asset);
    setToAsset(tokens[1].asset);
    setTarget(origin);
    setPay('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);

  const crossChain = target !== origin;
  const from: ChainToken = tokens.find((tk) => tk.asset === fromAsset) ?? tokens[0];
  const sameOptions = tokens.filter((tk) => tk.asset !== from.asset);
  const to = sameOptions.find((tk) => tk.asset === toAsset) ?? sameOptions[0];

  const enabled = store.gatewayAccess;
  const mainnet = networkEnv(store.network) === 'prod';
  const owner = store.chainAddress(origin);
  const recipient = crossChain ? store.chainAddress(target) : owner;
  const chainName = (c: CrossChainNetwork) => t(`xswap.chain.${c}`);

  // Balances on the origin chain; reloaded after each swap (busy → false).
  useEffect(() => {
    store.ensureChainAddresses();
    if (!owner || !mainnet) return;
    let cancelled = false;
    setBalances(undefined);
    store.chainBalances(origin).then((b) => { if (!cancelled) setBalances(b); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, owner, mainnet, store.busy]);

  useEffect(() => {
    if (!crossChain || xAssets.length) return;
    let cancelled = false;
    store.crossChainAssets().then((list) => { if (!cancelled) setXAssets(list); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossChain]);

  const destOptions: CrossChainAsset[] = !crossChain
    ? []
    : target === 'stellar'
      ? xAssets.filter((a) => a.chain === 'stellar')
      : CROSS_CHAIN_TARGET_SYMBOLS[target]
          .map((sym) => xAssets.find((a) => a.chain === target && a.symbol === sym))
          .filter((a): a is CrossChainAsset => !!a);
  const xDest = destOptions.find((a) => a.assetId === xDestId) ?? destOptions[0] ?? null;

  const balance = balances?.[from.asset] ?? 0n;
  const reserve = from.asset === 'native' ? NATIVE_RESERVE[origin] : 0n;
  const avail = balance > reserve ? balance - reserve : 0n;
  const units = toMinorUnitsBig(pay, from.decimals);
  const insufficient = !!units && units > avail;
  const ready = enabled && mainnet && !!owner && !!recipient && !!units && units > 0n && !insufficient;
  const payNum = parseDecimalOr0(pay);

  useEffect(() => {
    setQuote(null);
    setXQuote(null);
  }, [pay, from.asset, to?.asset, target, xDest?.assetId]);

  useEffect(() => {
    if (!ready || (crossChain ? !xDest : !to)) return;
    let cancelled = false;
    const run = async () => {
      setQuoting(true);
      if (crossChain) {
        const q = await store.quoteCrossChainFrom(origin, pay, from, xDest!);
        if (cancelled) return;
        setQuoting(false);
        if (q) setXQuote(q);
      } else {
        const q = await store.quoteChainSwap(origin, pay, from, to!);
        if (cancelled) return;
        setQuoting(false);
        if (q) setQuote(q);
      }
    };
    const debounce = setTimeout(run, QUOTE_DEBOUNCE_MS);
    const refresh = setInterval(run, QUOTE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pay, from.asset, to?.asset, target, xDest?.assetId]);

  const receive = crossChain
    ? xQuote ? parseFloat(xQuote.destination.amount) || 0 : 0
    : quote ? parseFloat(quote.destination.estimated) || 0 : 0;
  const receiveCode = crossChain ? xDest?.symbol ?? '' : to?.symbol ?? '';
  const rate = receive > 0 && payNum > 0 ? receive / payNum : null;
  const human = (v: bigint) => trim(parseFloat(fromMinorUnits(v, from.decimals) ?? '0') || 0, 4);

  const rows: [string, string][] = crossChain
    ? xQuote
      ? [
          [t('swap.feeRate'), `${trim(xQuote.fee.bps / 100, 2)}%`],
          [t('swap.fee'), `${trim(parseFloat(xQuote.fee.amount) || 0, 4)} ${xQuote.fee.asset}`],
          [t('swap.receiveEst'), `${trim(parseFloat(xQuote.destination.amount) || 0, 4)} ${xQuote.destination.asset}`],
          [t('swap.minReceived'), `${trim(parseFloat(xQuote.destination.minimum) || 0, 4)} ${xQuote.destination.asset}`],
          [t('xswap.eta'), `~${xQuote.timeEstimateSeconds} s`],
        ]
      : []
    : quote && to
      ? [
          [t('swap.feeRate'), `${trim(quote.fee.bps / 100, 2)}%`],
          [t('swap.fee'), `${trim(parseFloat(quote.fee.amount) || 0, 6)} ${to.symbol}`],
          [t('swap.receiveEst'), `${trim(parseFloat(quote.destination.estimated) || 0, 4)} ${to.symbol}`],
          [t('swap.minReceived'), `${trim(parseFloat(quote.destination.minimum) || 0, 4)} ${to.symbol}`],
        ]
      : [];

  const canSubmit = ready && !store.busy && (crossChain ? !!xDest && !!xQuote : !!to && !!quote);
  const submit = () => {
    if (crossChain) {
      if (xDest && xQuote) store.submitCrossChainFrom(origin, pay, from, xDest, xQuote);
    } else if (to && quote) {
      store.submitChainSwap(origin, pay, from, to, quote);
    }
  };

  const note = crossChain
    ? t('xswap.noteFrom', { origin: chainName(origin), chain: chainName(target) })
    : t(origin === 'solana' ? 'xswap.noteSolana' : 'xswap.noteMonad');

  return (
    <>
      {header}

      <div className="swap-target" role="group" aria-label={t('xswap.receiveOn')}>
        <div className="swap-target-label">{t('xswap.receiveOn')}</div>
        {TARGETS.map((c) => (
          <button key={c} className={cx('swap-target-btn', target === c && 'is-on')} onClick={() => setTarget(c)}>
            {chainName(c)}
          </button>
        ))}
      </div>

      <div className="exchange-stack">
        <div className="glass exchange-card">
          <div className="exchange-label">{t('swap.pay')} · {chainName(origin)}</div>
          <div className="row between g10">
            <div className="swap-dest-chips">
              {tokens.map((tk) => (
                <button key={tk.asset} className={cx('swap-target-btn', from.asset === tk.asset && 'is-on')} onClick={() => setFromAsset(tk.asset)}>
                  {tk.symbol}
                </button>
              ))}
            </div>
            <input
              value={pay}
              placeholder="0"
              onChange={(e) => { const v = sanitizeDecimalInput((e.target as HTMLInputElement).value); if (v !== null) setPay(v); }}
              inputMode="decimal"
              className="exchange-input"
            />
          </div>
          <div className="exchange-balance">
            {t('swap.balance')}: {balances === undefined && owner && mainnet ? '…' : human(balance)} {from.symbol}
          </div>
          {reserve > 0n && (
            <div className="swap-rate">{t('xswap.reserve', { amount: human(reserve), code: from.symbol })}</div>
          )}
        </div>
        <div className="swap-seam" />
        <div className="glass exchange-card exchange-card--to">
          <div className="exchange-label">{t('swap.receiveEst')} · {chainName(target)}</div>
          <div className="row between g10">
            <div className="swap-dest-chips">
              {crossChain
                ? destOptions.map((a) => (
                    <button key={a.assetId} className={cx('swap-target-btn', xDest?.assetId === a.assetId && 'is-on')} onClick={() => setXDestId(a.assetId)}>
                      {a.symbol}
                    </button>
                  ))
                : sameOptions.map((tk) => (
                    <button key={tk.asset} className={cx('swap-target-btn', to?.asset === tk.asset && 'is-on')} onClick={() => setToAsset(tk.asset)}>
                      {tk.symbol}
                    </button>
                  ))}
            </div>
            <div className={cx('swap-receive', !receive && 'is-empty')}>{receive ? trim(receive, 4) : '—'}</div>
          </div>
          {rate !== null && (
            <div className="swap-rate">
              1 {from.symbol} ≈ {trim(rate, rate < 1 ? 6 : 4)} {receiveCode}
            </div>
          )}
          {recipient && (
            <div className="swap-rate">
              {t('xswap.to')}: {shortAddr(recipient)}
            </div>
          )}
        </div>
      </div>

      {!mainnet && <div className="exchange-guard">{t('xswap.mainnetOnly')}</div>}
      {mainnet && !owner && <div className="exchange-guard">{t('xswap.noAddress', { chain: chainName(origin) })}</div>}
      {mainnet && owner && crossChain && !recipient && (
        <div className="exchange-guard">{t('xswap.noAddress', { chain: chainName(target) })}</div>
      )}
      {mainnet && owner && balances === null && (
        <div className="exchange-guard">{t('xswap.balanceError', { chain: chainName(origin) })}</div>
      )}
      {insufficient && (
        <div className="exchange-guard exchange-guard--danger">
          {t('swap.insufficient', { avail: human(avail), code: from.symbol })}
        </div>
      )}

      {enabled && quoting && (
        <div className="center g8 swap-quoting">
          <Spinner tone="dim" /> {t('swap.quoting')}
        </div>
      )}

      {rows.length > 0 && (
        <div className="glass exchange-quote">
          {rows.map(([label, val]) => (
            <div key={label} className="exchange-quote-row">
              <span className="exchange-quote-label">{label}</span>
              <span className="exchange-quote-val">{val}</span>
            </div>
          ))}
        </div>
      )}

      {enabled && <div className="glass exchange-note">{note}</div>}
      {enabled && store.publicAccess && <div className="glass exchange-note">{t('swap.publicRate')}</div>}

      <div className="spacer" />
      <div className="kb-dock">
        <PrimaryButton disabled={!canSubmit} onClick={submit}>
          {store.busy ? <Spinner /> : t('swap.cta')}
        </PrimaryButton>
      </div>
    </>
  );
}
