import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { PrimaryButton, GhostButton } from '@/ui/Buttons';
import { Field } from '@/ui/Field';
import { KVRow } from '@/ui/KVRow';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { Select } from '@/features/fiat/Select';
import { ELDORADO_DEFAULT_CURRENCY, ELDORADO_NETWORK } from '@/constants/eldorado';
import {
  ELDORADO_CLIENT_ID,
  ELDORADO_REFERRAL_ID,
  loadP2pMarket,
  p2pAmountProblem,
  p2pEstimate,
  p2pReference,
  p2pTokens,
  p2pWidgetUrl,
  type P2pMarket,
} from '@/lib/eldorado';
import { openExternal } from '@/lib/openExternal';
import { shortAddr } from '@/lib/format';
import '@/styles/features/fiat/p2p-buy.css';

/**
 * Buy a stablecoin with local money from people selling it (P2P), delivered to the wallet's
 * Arbitrum account. The wallet fills the order in and opens the provider's widget, where the
 * person signs in, verifies their identity and pays (`src/lib/eldorado.ts` says why it opens
 * outside the wallet). The amount here is an estimate; the widget quotes before payment.
 */
export function P2pBuy({ store }: { store: WalletStore }) {
  const t = store.t;
  const env = store.chainNet;
  const { ensureChainAddresses, addressOn } = store;
  const [market, setMarket] = useState<P2pMarket | null>(null);
  const [failed, setFailed] = useState(false);
  const [currencyId, setCurrencyId] = useState('');
  const [methodId, setMethodId] = useState('');
  const [tokenAsset, setTokenAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  const load = useCallback(() => {
    setFailed(false);
    setMarket(null);
    loadP2pMarket(env, store.lang)
      .then((m) => {
        setMarket(m);
        const first = m.currencies.find((c) => c.id === ELDORADO_DEFAULT_CURRENCY) ?? m.currencies[0];
        setCurrencyId((prev) => (m.currencies.some((c) => c.id === prev) ? prev : first?.id ?? ''));
      })
      .catch(() => setFailed(true));
  }, [env, store.lang]);

  useEffect(load, [load]);

  const tokens = p2pTokens(env);
  const token = tokens.find((x) => x.asset === tokenAsset) ?? tokens[0];
  const currency = market?.currencies.find((c) => c.id === currencyId) ?? null;
  const method = currency?.methods.find((m) => m.id === methodId) ?? currency?.methods[0] ?? null;
  const address = addressOn(ELDORADO_NETWORK);
  const fmt = useMemo(() => new Intl.NumberFormat(store.lang, { maximumFractionDigits: 2 }), [store.lang]);

  const problem = currency ? p2pAmountProblem(amount, currency) : 'empty';
  const estimate = currency ? p2pEstimate(amount, currency) : null;
  const amountError =
    problem === 'below-min' && currency ? t('p2p.belowMin', { min: fmt.format(currency.minIn), currency: currency.id }) : undefined;
  const ready = !!currency && !!method && !!address && problem === null && !opening;

  const changeCurrency = (id: string) => {
    setCurrencyId(id);
    setMethodId('');
  };

  const open = async () => {
    if (!currency || !method || !address) return;
    const url = p2pWidgetUrl({
      env,
      address,
      currency: currency.id,
      method: method.id,
      token,
      amount,
      clientId: ELDORADO_CLIENT_ID || undefined,
      referralId: ELDORADO_REFERRAL_ID || undefined,
      reference: ELDORADO_CLIENT_ID ? p2pReference() : undefined,
    });
    if (!url) return store.flash(t('p2p.noAddress'), 'err');
    setOpening(true);
    const ok = await openExternal(url);
    setOpening(false);
    store.flash(ok ? t('p2p.opened') : t('p2p.openFailed'), ok ? 'ok' : 'err');
  };

  return (
    <div className="scr screen col pb-104">
      <ScreenHeader title={t('p2p.title')} desc={t('p2p.desc')} onBack={store.goBack} />

      {failed ? (
        <div className="col g12">
          <Notice tone="danger">{t('p2p.loadFailed')}</Notice>
          <GhostButton onClick={load}>{t('p2p.retry')}</GhostButton>
        </div>
      ) : !market ? (
        <div className="center p2p-loading">
          <Spinner />
        </div>
      ) : market.currencies.length === 0 ? (
        <Notice>{t('p2p.noMarket')}</Notice>
      ) : (
        <>
          <Select label={t('p2p.currency')} value={currency?.id ?? ''} onChange={changeCurrency}>
            {market.currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.id})
              </option>
            ))}
          </Select>
          <Select label={t('fiat.method')} value={method?.id ?? ''} onChange={setMethodId}>
            {(currency?.methods ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select label={t('p2p.receiveToken')} value={token.asset} onChange={setTokenAsset}>
            {tokens.map((x) => (
              <option key={x.asset} value={x.asset}>
                {x.symbol}
              </option>
            ))}
          </Select>
          <Field
            tone="soft"
            kind="amount"
            label={t('p2p.amount', { currency: currency?.id ?? '' })}
            value={amount}
            onChange={setAmount}
            placeholder={currency ? fmt.format(currency.minIn) : '0'}
            error={amountError}
          />

          <div className="p2p-summary">
            <KVRow label={t('p2p.youGetAbout')} value={`≈ ${fmt.format(estimate ?? 0)} ${token.symbol}`} />
            <KVRow
              label={t('p2p.arrivesOn')}
              value={store.networkName(ELDORADO_NETWORK)}
              sub={address ? shortAddr(address, 6, 4) : t('p2p.addressPending')}
            />
          </div>

          <Notice className="p2p-note">{t('p2p.note')}</Notice>
          {env === 'testnet' && <Notice className="p2p-note">{t('p2p.testNote')}</Notice>}

          <div className="spacer" />
          <div className="kb-dock">
            <PrimaryButton disabled={!ready} onClick={() => void open()}>
              {opening ? <Spinner /> : t('p2p.continue')}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}
