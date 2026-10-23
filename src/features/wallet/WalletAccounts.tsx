import { useEffect } from 'react';
import type { WalletStore } from '@/state/store';
import { NavMenu } from '@/app/NavMenu';
import { AssetLogo } from '@/ui/AssetLogo';
import { ChainLogo } from '@/ui/ChainLogo';
import { Icon } from '@/ui/Icon';
import { ExternalLink } from '@/ui/ExternalLink';
import { useCopied } from '@/hooks/useCopied';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { chainRows, computePortfolio, type AssetRow } from '@/lib/portfolio';
import { chainAddressOf } from '@/lib/chainAddressBook';
import { explorerAccountUrl } from '@/lib/stellar';
import { fmt, shortAddr, splitMoney, trim } from '@/lib/format';
import { staggerClass } from '@/lib/stagger';
import { CHAIN_EXPLORER_ADDRESS_BY_NET, CHAIN_TESTNET_FAUCET, OTHER_CHAINS, type OtherChain } from '@/constants/chains';
import { cx } from '@/lib/cx';
import '@/styles/features/wallet/wallet-accounts.css';

type Network = 'stellar' | OtherChain;

/**
 * Every account the wallet holds, network by network — the bar's "Wallet" tab. One
 * recovery phrase is an address on each chain (`lib/chainAddresses.ts`); this is the one
 * screen that shows them side by side, each with what it holds, its address to copy and
 * the two verbs that matter for an account: receive into it, send out of it.
 */
export function WalletAccounts({ store }: { store: WalletStore }) {
  const t = store.t;
  const net = store.chainNet;
  const { ensureChainAddresses } = store;
  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  const extra = chainRows(store.chainHoldings, net, store.prices);
  const { total, rows } = computePortfolio(store.account, store.prices, store.network.id, extra);
  const money = splitMoney(useAnimatedNumber(total));
  const hasPhrase = !!store.meta?.chainAddresses;
  const networks: Network[] = ['stellar', ...OTHER_CHAINS];

  return (
    <div className="scr screen pb-110">
      <div className="main-head">
        <span className="title-24">{t('accounts.title')}</span>
        <NavMenu store={store} />
      </div>

      <section className="accounts-total">
        <span className="accounts-total-label">{t('accounts.total')}</span>
        <span className="accounts-total-value">
          {money.whole}
          <span className="accounts-total-cents">{money.cents}</span>
        </span>
        <span className="desc">{t(hasPhrase ? 'accounts.desc' : 'accounts.noPhrase')}</span>
      </section>

      <div className="accounts-list">
        {networks.map((n, i) => {
          const address = n === 'stellar' ? store.meta?.publicKey ?? null : chainAddressOf(store.meta?.chainAddresses, n, net);
          if (n !== 'stellar' && !hasPhrase) return null;
          const held = rows.filter((r) => (n === 'stellar' ? !r.chain : r.chain === n));
          const unreadable = n !== 'stellar' && !!store.chainHoldings && store.chainHoldings[n] === null;
          return (
            <AccountCard
              key={n}
              store={store}
              network={n}
              address={address}
              rows={held}
              unreadable={unreadable}
              index={i}
            />
          );
        })}
      </div>
    </div>
  );
}

function AccountCard({
  store,
  network,
  address,
  rows,
  unreadable,
  index,
}: {
  store: WalletStore;
  network: Network;
  address: string | null;
  rows: AssetRow[];
  unreadable: boolean;
  index: number;
}) {
  const t = store.t;
  const net = store.chainNet;
  const [copied, copy] = useCopied();
  const value = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const name = network === 'stellar' ? t('xswap.chain.stellar') : t(`chains.net.${net}.${network}`);
  const explorer =
    !address ? null : network === 'stellar' ? explorerAccountUrl(store.network, address) : CHAIN_EXPLORER_ADDRESS_BY_NET[net][network](address);

  const receive = () => {
    store.setReceiveNet(network);
    store.setScreen('receive');
  };
  const send = () => {
    if (network === 'stellar') {
      store.setScreen('send');
      return;
    }
    store.setChainAsset({ chain: network, asset: 'native' });
    store.setScreen('chain-send');
  };
  const open = (r: AssetRow) => {
    if (r.chain && r.asset) {
      store.setChainAsset({ chain: r.chain, asset: r.asset });
      store.setScreen('chain-asset');
    } else {
      store.setSelectedAsset(r.code);
      store.setScreen('asset');
    }
  };

  return (
    <article className={cx('account-card', staggerClass(index))}>
      <header className="account-head">
        <ChainLogo chain={network} size={38} />
        <div className="account-id">
          <span className="account-name">{name}</span>
          {address ? (
            <button type="button" onClick={() => copy(address)} className={cx('account-addr', copied && 'is-copied')}>
              {shortAddr(address, 6, 6)}
              <Icon name={copied ? 'check' : 'copy'} size={14} />
            </button>
          ) : (
            <span className="account-addr is-pending">{t('accounts.deriving')}</span>
          )}
        </div>
        <span className="account-value">$ {fmt(value, 2)}</span>
      </header>

      {unreadable ? (
        <div className="account-note">{t('chains.unreachable')}</div>
      ) : (
        <div className="account-tokens">
          {rows.map((r) => (
            <button key={`${r.code}:${r.asset ?? r.issuer ?? ''}`} type="button" onClick={() => open(r)} className="account-token">
              <AssetLogo code={r.code} size={20} />
              <span className="account-token-amt">{trim(r.amount, 6)}</span>
              <span className="account-token-code">{r.code}</span>
            </button>
          ))}
        </div>
      )}

      <footer className="account-actions">
        <button type="button" onClick={receive} disabled={!address} className="account-btn">
          <Icon name="receive" size={18} /> {t('common.receive')}
        </button>
        <button type="button" onClick={send} disabled={!address} className="account-btn">
          <Icon name="send" size={18} /> {t('common.send')}
        </button>
        {net === 'testnet' && network !== 'stellar' && (
          <ExternalLink href={CHAIN_TESTNET_FAUCET[network]} className="account-btn is-icon is-ghost" ariaLabel={t('accounts.faucet')}>
            <Icon name="gift" size={18} />
          </ExternalLink>
        )}
        {explorer && (
          <ExternalLink href={explorer} className="account-btn is-icon" ariaLabel={t('asset.explorer')}>
            <Icon name="external" size={18} />
          </ExternalLink>
        )}
      </footer>
    </article>
  );
}
