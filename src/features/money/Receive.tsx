import { useEffect, useMemo, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { AssetLogo } from '@/ui/AssetLogo';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { CheckIcon, ChevronRightIcon, CopyIcon, LinkIcon } from '@/ui/Icons';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { NetworkPicker } from '@/features/money/NetworkPicker';
import { qrDataUrl } from '@/lib/qr';
import { buildSep7Pay } from '@/lib/sep7';
import { shareText } from '@/lib/share';
import { useCopied } from '@/hooks/useCopied';
import { NETWORKS, NETWORK_IDS, type NetworkId } from '@/constants/networks';
import '@/styles/features/money/receive.css';

/** The networks whose test network the wallet follows; every other one is mainnet only. */
const TEST_NETWORKS: readonly NetworkId[] = ['stellar', 'solana', 'monad'];

/* ----------------------------- RECEIVE ------------------------------ */
/**
 * One screen for every address the wallet holds: Stellar and every network the same phrase
 * derives (`constants/networks.ts`), chosen with the network picker. Each has its QR (on the
 * canvas, no box around it), its address to copy or share, and — off Stellar — a warning,
 * because a token sent on the wrong network to one of these does not arrive.
 */
export function Receive({ store }: { store: WalletStore }) {
  const t = store.t;
  const [qr, setQr] = useState('');
  const [copied, copy] = useCopied();
  // Opens on the network the caller asked for (the Wallet tab's QR), once.
  const [net, setNet] = useState<NetworkId>(store.receiveNet);
  const { ensureChainAddresses, setReceiveNet, addressOn } = store;

  useEffect(() => {
    setReceiveNet('stellar');
  }, [setReceiveNet]);
  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  // Only networks the wallet has an address on: a family this build cannot derive is not offered.
  const offered = useMemo(() => NETWORK_IDS.filter((id) => !!addressOn(id)), [addressOn]);
  const def = NETWORKS[net];
  const addr = addressOn(net) ?? '';
  // A test Stellar network moves Solana and Monad to their test networks; the others have none,
  // so what arrives at those addresses is real.
  const mainnetOnly = store.chainNet === 'testnet' && !TEST_NETWORKS.includes(net);

  useEffect(() => {
    setQr('');
    if (!addr) return;
    // Stellar encodes a SEP-7 payment request so other Stellar wallets pre-fill the send. The
    // other networks get the bare address: it is what every wallet on those chains scans.
    qrDataUrl(net === 'stellar' ? buildSep7Pay({ destination: addr }) : addr)
      .then(setQr)
      .catch(() => {});
  }, [net, addr]);

  const label = t('receive.addrOn', { network: def.name });
  const share = async () => {
    // Native share sheet, Web Share, or — when neither exists — the clipboard.
    if (!(await shareText(addr, label))) void copy(addr);
  };

  return (
    <div className="scr screen col pb-24">
      <ScreenHeader
        title={t('receive.title')}
        // "and tokens" only where there are tokens to receive: Bitcoin has none.
        desc={t(net === 'stellar' || def.address === 'evm' || def.tokens.length ? 'receive.descOn' : 'receive.descCoin', { network: def.name, coin: def.coin })}
        onBack={store.goBack}
      />

      {offered.length > 1 && <NetworkPicker value={net} onPick={setNet} networks={offered} t={t} />}

      <div key={net} className="receive-panel">
        <div className="receive-qr">
          {qr ? <img src={qr} width="220" height="220" alt={t('receive.qrAlt', { network: label })} className="receive-qr-img" /> : <Spinner tone="text" />}
        </div>

        <div className="receive-addr">
          <AssetLogo code={def.coin} size={34} />
          <div className="receive-addr-main">
            <span className="receive-addr-label">{label}</span>
            <span className="receive-addr-value">{addr}</span>
          </div>
        </div>

        {net !== 'stellar' && (
          <Notice tone="danger" className="receive-warn">
            {t(def.address === 'evm' ? 'receive.onlyThisNetworkEvm' : 'receive.onlyThisNetwork', { chain: def.name })}
          </Notice>
        )}
        {mainnetOnly && <Notice className="receive-warn">{t('receive.mainnetOnly', { network: def.name })}</Notice>}

        <div className="receive-actions">
          <PrimaryButton onClick={() => void copy(addr)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? t('common.copied') : t('common.copy')}
          </PrimaryButton>
          <GhostButton onClick={() => void share()}>{t('common.share')}</GhostButton>
        </div>

        {net === 'stellar' && (
          <button type="button" onClick={() => store.setScreen('paylink')} className="receive-link-row">
            <span className="receive-link-icon" aria-hidden="true">
              <LinkIcon />
            </span>
            <span className="receive-link-text">
              <span className="receive-link-title">{t('paylink.title')}</span>
              <span className="receive-link-desc">{t('paylink.entryDesc')}</span>
            </span>
            <ChevronRightIcon className="receive-link-chev" />
          </button>
        )}
      </div>
    </div>
  );
}
