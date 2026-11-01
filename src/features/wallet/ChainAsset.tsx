import type { WalletStore } from '@/state/store';
import { AssetLogo } from '@/ui/AssetLogo';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { ExternalLink } from '@/ui/ExternalLink';
import { chainRows } from '@/lib/portfolio';
import { fmt, trim } from '@/lib/format';
import {
  CHAIN_EXPLORER_ADDRESS_BY_NET,
  CHAIN_TESTNET_FAUCET,
  CHAIN_TOKENS_BY_NET,
  USDC_TESTNET_FAUCET,
} from '@/constants/chains';
import '@/styles/features/wallet/asset.css';

/**
 * A Solana or Monad holding, opened from its row on Home: balance, value, and the same three
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
  const address = store.meta?.chainAddresses?.[chain] ?? null;
  const holdings = store.chainHoldings;
  const row = chainRows(holdings, net, store.prices).find((r) => r.chain === chain && r.asset === token.asset);
  const unreadable = !!holdings && holdings[chain] === null;
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
  return (
    <div className="scr screen col pb-30">
      <ScreenHeader title={token.symbol} desc={networkName} onBack={store.goBack} />

      <section className="asset-hero" aria-label={t('asset.balance')}>
        <AssetLogo code={token.symbol} size={64} />
        <div className="asset-hero-text">
          <p className="asset-price">
            {row ? trim(row.amount, 6) : holdings ? '0' : '…'} {token.symbol}
          </p>
          <p className="asset-change">{row?.value != null ? '≈ $' + fmt(row.value, 2) : '—'}</p>
        </div>
      </section>
      {unreadable && <Notice tone="danger" className="asset-notice">{t('chains.unreachable')}</Notice>}

      <div className="asset-actions is-three">
        <PrimaryButton onClick={send} disabled={!address}>
          {t('common.send')}
        </PrimaryButton>
        <GhostButton onClick={receive} disabled={!address}>
          {t('common.receive')}
        </GhostButton>
        <GhostButton onClick={swap} disabled={testnet || !address}>
          {t('chains.swap')}
        </GhostButton>
      </div>
      {testnet && <p className="asset-note">{t('chains.swapMainnetOnly')}</p>}

      {testnet && address && (
        <section className="asset-fund" aria-labelledby="asset-fund-title">
          <h2 id="asset-fund-title" className="asset-fund-title">
            {t('chains.fundTitle')}
          </h2>
          <p className="asset-note">{t('chains.descTestnet')}</p>
          <div className="asset-fund-actions">
            {/* The faucets are web pages now: Solana closed the devnet RPC airdrop (it answers
                410 "The RPC faucet is closed on this cluster"), so no button here can pay. */}
            <ExternalLink href={CHAIN_TESTNET_FAUCET[chain]} className="link-btn">
              {t(chain === 'solana' ? 'chains.webFaucet' : 'chains.getMon')}
            </ExternalLink>
            <ExternalLink href={USDC_TESTNET_FAUCET} className="link-btn">
              {t('chains.usdcFaucet')}
            </ExternalLink>
          </div>
        </section>
      )}

      {address && (
        <ExternalLink href={CHAIN_EXPLORER_ADDRESS_BY_NET[net][chain](address)} className="link-btn asset-explorer">
          {t('asset.explorer')}
        </ExternalLink>
      )}
    </div>
  );
}
