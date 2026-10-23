import type { WalletStore } from '@/state/store';
import { AssetLogo } from '@/ui/AssetLogo';
import { BackBar } from '@/ui/BackBar';
import { ExternalLink } from '@/ui/ExternalLink';
import { Spinner } from '@/ui/Spinner';
import { useBusy } from '@/hooks/useBusy';
import { chainRows, computePortfolio } from '@/lib/portfolio';
import { AssetStats } from '@/features/wallet/AssetStats';
import { chainAddressOf } from '@/lib/chainAddressBook';
import { fmt, trim } from '@/lib/format';
import {
  CHAIN_EXPLORER_ADDRESS_BY_NET,
  CHAIN_TESTNET_FAUCET,
  CHAIN_TOKENS_BY_NET,
  USDC_TESTNET_FAUCET,
} from '@/constants/chains';
import '@/styles/features/wallet/chain-asset.css';

/**
 * A holding on one of the other chains, opened from its row on Home: balance, value, and the same three
 * verbs a Stellar asset has — send, receive, swap. The network follows the Stellar one
 * (`store.chainNet`); a test network adds a way to fund the address.
 *
 * Swaps run on mainnet only: Jupiter, Kuru Flow and NEAR Intents have no testnet, so on a
 * test network the button is there, disabled, with the reason under it rather than missing.
 */
export function ChainAsset({ store }: { store: WalletStore }) {
  const t = store.t;
  const net = store.chainNet;
  const testnet = net === 'testnet';
  const { chain, asset } = store.chainAsset;
  const tokens = CHAIN_TOKENS_BY_NET[net][chain];
  const token = tokens.find((tk) => tk.asset === asset) ?? tokens[0];
  const address = chainAddressOf(store.meta?.chainAddresses, chain, net);
  const holdings = store.chainHoldings;
  const extra = chainRows(holdings, net, store.prices);
  const row = extra.find((r) => r.chain === chain && r.asset === token.asset);
  const { total } = computePortfolio(store.account, store.prices, store.network.id, extra);
  const unreadable = !!holdings && holdings[chain] === null;
  const [busy, run] = useBusy();
  const networkName = t(`chains.net.${net}.${chain}`);

  const send = () => store.setScreen('chain-send');
  const receive = () => {
    store.setReceiveNet(chain);
    store.setScreen('receive');
  };
  const swap = () => {
    store.setSwapOrigin(chain);
    store.setScreen('swap');
  };
  const airdrop = () =>
    run(async () => {
      if (await store.airdropTestnetSol()) await store.loadChainHoldings(true);
    });

  return (
    <div className="scr screen pb-30">
      <BackBar title={networkName} onBack={store.goBack} />

      <div className="row g10 chain-asset-head">
        <AssetLogo code={token.symbol} chain={chain} size={48} />
        <div className="min0">
          <div className="chain-asset-symbol">{token.symbol}</div>
          <div className="chain-asset-net">{networkName}</div>
        </div>
      </div>

      <div className="glass card chain-asset-bal">
        <div className="chain-asset-bal-label">{t('asset.balance')}</div>
        <div className="chain-asset-bal-value">
          {row ? trim(row.amount, 6) : holdings ? '0' : '…'} {token.symbol}
        </div>
        <div className="chain-asset-bal-fiat">{row?.value != null ? '≈ $' + fmt(row.value, 2) : '—'}</div>
        {unreadable && <div className="chain-asset-err">{t('chains.unreachable')}</div>}
      </div>

      <AssetStats
        store={store}
        value={row?.value ?? null}
        change24h={store.prices[token.symbol]?.change24h ?? null}
        total={total}
      />

      <div className="flexr g10 chain-asset-actions">
        <button onClick={send} disabled={!address} className="chain-asset-btn is-primary">{t('common.send')}</button>
        <button onClick={receive} disabled={!address} className="glass-soft chain-asset-btn">{t('common.receive')}</button>
        <button onClick={swap} disabled={testnet || !address} className="glass-soft chain-asset-btn">{t('chains.swap')}</button>
      </div>
      {testnet && <div className="chain-asset-note">{t('chains.swapMainnetOnly')}</div>}

      {testnet && address && (
        <div className="glass card chain-asset-fund">
          <div className="chain-asset-fund-title">{t('chains.fundTitle')}</div>
          <div className="chain-asset-note">{t('chains.descTestnet')}</div>
          <div className="flexr g8 chain-asset-fund-actions">
            {chain === 'solana' && (
              <button onClick={airdrop} disabled={busy} className="f1 chain-asset-fund-btn">
                {busy ? <Spinner size={15} /> : t('chains.airdrop')}
              </button>
            )}
            <ExternalLink href={CHAIN_TESTNET_FAUCET[chain]} className="f1 chain-asset-fund-btn">
              {t(chain === 'monad' ? 'chains.getMon' : 'chains.webFaucet')} ↗
            </ExternalLink>
          </div>
          <ExternalLink href={USDC_TESTNET_FAUCET} className="chain-asset-link">
            {t('chains.usdcFaucet')} ↗
          </ExternalLink>
        </div>
      )}

      {address && (
        <ExternalLink href={CHAIN_EXPLORER_ADDRESS_BY_NET[net][chain](address)} className="chain-asset-link chain-asset-explorer">
          {t('asset.explorer')}
        </ExternalLink>
      )}
    </div>
  );
}
