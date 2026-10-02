import { useCallback, useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { AssetLogo } from '@/ui/AssetLogo';
import { ExternalLink } from '@/ui/ExternalLink';
import { Spinner } from '@/ui/Spinner';
import { useBusy } from '@/hooks/useBusy';
import { useCopied } from '@/hooks/useCopied';
import { fromMinorUnits } from '@/lib/amount';
import { trim } from '@/lib/format';
import { cx } from '@/lib/cx';
import {
  CHAIN_TESTNET_EXPLORER_ADDRESS,
  CHAIN_TESTNET_FAUCET,
  CHAIN_TESTNET_TOKENS,
  OTHER_CHAINS,
  USDC_TESTNET_FAUCET,
  type OtherChain,
} from '@/constants/chains';
import '@/styles/features/wallet/testnet-chains-card.css';

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

/**
 * Test SOL, MON and USDC beside test XLM: the phrase's Solana devnet and Monad testnet
 * addresses, their balances, a way to fund each and a way to send from it. Home renders
 * it only while the Stellar network is a test one; a wallet imported from a bare secret
 * has no phrase, and so no card.
 */
export function TestnetChainsCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const chains = store.meta?.chainAddresses;
  const { ensureChainAddresses } = store;

  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  if (!chains) return null;
  return (
    <div className="glass card testnet-chains">
      <div className="testnet-chains-title">{t('testnetChains.title')}</div>
      <div className="testnet-chains-desc">{t('testnetChains.desc')}</div>
      {OTHER_CHAINS.map((chain) => (
        <ChainRow key={chain} store={store} chain={chain} address={chains[chain]} />
      ))}
      <ExternalLink href={USDC_TESTNET_FAUCET} className="testnet-chains-usdc">
        {t('testnetChains.usdcFaucet')} ↗
      </ExternalLink>
    </div>
  );
}

function ChainRow({ store, chain, address }: { store: WalletStore; chain: OtherChain; address: string }) {
  const t = store.t;
  const tokens = CHAIN_TESTNET_TOKENS[chain];
  const [balances, setBalances] = useState<Record<string, bigint> | null | undefined>(undefined);
  const [busy, run] = useBusy();
  const [copied, copy] = useCopied();
  const { testnetChainBalances } = store;

  const load = useCallback(async () => {
    setBalances(undefined);
    setBalances(await testnetChainBalances(chain));
  }, [testnetChainBalances, chain]);

  // Reloaded after a send too: the store's busy flag drops when one finishes.
  useEffect(() => {
    if (!store.busy) void load();
  }, [load, store.busy]);

  const airdrop = () =>
    run(async () => {
      if (await store.airdropTestnetSol()) await load();
    });
  const send = () => {
    store.setChainSendTarget(chain);
    store.setScreen('chain-send');
  };

  const shown = (asset: string, decimals: number) => {
    if (balances === undefined) return '…';
    if (balances === null) return '—';
    return trim(parseFloat(fromMinorUnits(balances[asset] ?? 0n, decimals) ?? '0') || 0, 4);
  };

  return (
    <div className="testnet-chain">
      <div className="row g10 min0">
        <AssetLogo code={tokens[0].symbol} size={34} />
        <div className="min0">
          <div className="testnet-chain-name">{t(`testnetChains.net.${chain}`)}</div>
          <ExternalLink href={CHAIN_TESTNET_EXPLORER_ADDRESS[chain](address)} className="testnet-chain-addr">
            {shortAddr(address)} ↗
          </ExternalLink>
        </div>
      </div>
      <div className="testnet-chain-balances">
        {tokens.map((tk) => (
          <div key={tk.asset} className="testnet-chain-balance">
            {shown(tk.asset, tk.decimals)} <span className="testnet-chain-symbol">{tk.symbol}</span>
          </div>
        ))}
      </div>
      {balances === null && <div className="testnet-chain-err">{t('testnetChains.unreachable')}</div>}
      <div className="row g8 testnet-chain-actions">
        {chain === 'solana' ? (
          <button onClick={airdrop} disabled={busy} className="f1 testnet-chain-btn is-primary">
            {busy ? <Spinner size={15} /> : t('testnetChains.airdrop')}
          </button>
        ) : (
          <ExternalLink href={CHAIN_TESTNET_FAUCET[chain]} className="f1 testnet-chain-btn is-primary">
            {t('testnetChains.getMon')} ↗
          </ExternalLink>
        )}
        <button onClick={send} className="f1 testnet-chain-btn">
          {t('common.send')}
        </button>
        <button onClick={() => copy(address)} className={cx('f1 testnet-chain-btn', copied && 'is-copied')}>
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      </div>
      {chain === 'solana' && (
        <ExternalLink href={CHAIN_TESTNET_FAUCET[chain]} className="testnet-chain-faucet">
          {t('testnetChains.webFaucet')} ↗
        </ExternalLink>
      )}
    </div>
  );
}
