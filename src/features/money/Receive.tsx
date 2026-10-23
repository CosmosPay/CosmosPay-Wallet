import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { BackBar } from '@/ui/BackBar';
import { Spinner } from '@/ui/Spinner';
import { Icon } from '@/ui/Icon';
import { ChainLogo } from '@/ui/ChainLogo';
import { NetworkPicker } from '@/features/money/NetworkPicker';
import { qrDataUrl } from '@/lib/qr';
import { buildSep7Pay } from '@/lib/sep7';
import { shareText } from '@/lib/share';
import { chainAddressOf } from '@/lib/chainAddressBook';
import { SWAP_NETWORKS, type SwapNetwork } from '@/lib/swapRoute';
import { CHAIN_TOKENS_BY_NET } from '@/constants/chains';
import { useCopied } from '@/hooks/useCopied';
import { cx } from '@/lib/cx';
import '@/styles/features/money/receive.css';

/* ----------------------------- RECEIVE ------------------------------ */
/**
 * One screen for every address the wallet holds: Stellar, and the Bitcoin, EVM and Solana
 * accounts the same phrase derives. Each network gets the same QR, copy and share — and a
 * line saying which assets belong there, because a token sent on the wrong network to one of
 * these does not arrive. A wallet with no phrase has only Stellar.
 */
export function Receive({ store }: { store: WalletStore }) {
  const t = store.t;
  const [qr, setQr] = useState('');
  const [copied, copy] = useCopied();
  // Opens on the network the Home card asked for, once: the next visit starts from Stellar.
  const [net, setNet] = useState<SwapNetwork>(store.receiveNet);
  const chains = store.meta?.chainAddresses;
  const { ensureChainAddresses, setReceiveNet } = store;

  useEffect(() => {
    setReceiveNet('stellar');
  }, [setReceiveNet]);

  // The phrase's other-chain addresses, derived the first time this screen opens.
  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  const stellar = store.meta?.publicKey ?? '';
  const addr = net === 'stellar' ? stellar : chainAddressOf(chains, net, store.chainNet) ?? '';
  const name = net === 'stellar' ? t('xswap.chain.stellar') : t(`chains.net.${store.chainNet}.${net}`);
  const tokens = net === 'stellar' ? '' : CHAIN_TOKENS_BY_NET[store.chainNet][net].map((tk) => tk.symbol).join(', ');

  useEffect(() => {
    setQr('');
    if (!addr) return;
    // Stellar encodes a SEP-0007 payment request so other Stellar wallets pre-fill the send.
    // The other chains get the bare address: it is what every wallet on those chains scans.
    qrDataUrl(net === 'stellar' ? buildSep7Pay({ destination: addr }) : addr).then(setQr).catch(() => {});
  }, [net, addr]);

  const share = async () => {
    // Native share sheet where there is one, Web Share in a browser that has it, clipboard
    // otherwise — `shareText` reports which, so the copy only happens when nothing else could.
    if (!(await shareText(addr, t('receive.addrOf', { chain: name })))) copy(addr);
  };

  return (
    <div className="scr screen pb-30">
      <BackBar title={t('receive.title')} onBack={store.goBack} />

      {chains && <NetworkPicker store={store} value={net} options={SWAP_NETWORKS} onPick={setNet} />}

      <div className="receive-desc">
        {net === 'stellar' ? t('receive.desc.stellar') : t('receive.descChain', { chain: name, tokens })}
      </div>

      <div key={`${net}:${addr}`} className="receive-qr">
        <span className="receive-qr-glow" aria-hidden="true" />
        {qr ? (
          <img src={qr} width="196" height="196" alt="QR" className="receive-qr-img" />
        ) : (
          <div className="receive-qr-ph">
            <Spinner tone="ink" />
          </div>
        )}
        <span className="receive-qr-badge">
          <ChainLogo chain={net} size={36} />
        </span>
      </div>

      <div className="receive-net-name">{name}</div>

      <button type="button" onClick={() => copy(addr)} className={cx('receive-addr-card', copied && 'is-copied')}>
        <span className="min0 receive-addr-text">
          <span className="receive-addr-label">{net === 'stellar' ? t('receive.addrLabel.stellar') : t('receive.addrOf', { chain: name })}</span>
          <span className="receive-addr-value">{addr || t('accounts.deriving')}</span>
        </span>
        <span className="receive-copy">
          <Icon name={copied ? 'check' : 'copy'} size={18} />
        </span>
      </button>
      {net !== 'stellar' && <div className="receive-warn">{t('receive.onlyThisNetwork', { chain: name })}</div>}
      <div className="flexr g10">
        <button type="button" onClick={() => copy(addr)} className="receive-btn">
          <Icon name={copied ? 'check' : 'copy'} size={18} />
          {copied ? t('common.copied') : t('common.copy')}
        </button>
        <button type="button" onClick={share} className="receive-btn receive-btn--share">
          <Icon name="share" size={18} />
          {t('common.share')}
        </button>
      </div>

      {net === 'stellar' && (
        <button type="button" onClick={() => store.setScreen('paylink')} className="receive-paylink">
          <span className="receive-paylink-icon">
            <Icon name="link" size={18} />
          </span>
          <span className="f1 min0 receive-paylink-text">
            <span className="receive-paylink-title">{t('paylink.title')}</span>
            <span className="receive-paylink-desc">{t('paylink.entryDesc')}</span>
          </span>
          <Icon name="chevron-right" size={22} className="receive-paylink-chev" />
        </button>
      )}
    </div>
  );
}
