import { useEffect, useMemo, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { NetworkLogo } from '@/ui/AssetLogo';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { CheckIcon, ChevronRightIcon, CopyIcon, LinkIcon } from '@/ui/Icons';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { NetworkPicker } from '@/features/money/NetworkPicker';
import { SendSection } from '@/features/money/SendParts';
import { qrDataUrl } from '@/lib/qr';
import { buildSep7Pay } from '@/lib/sep7';
import { shareText } from '@/lib/share';
import { useCopied } from '@/hooks/useCopied';
import { NETWORKS, NETWORK_GROUPS, NETWORK_IDS, type NetworkId } from '@/constants/networks';
import '@/styles/features/money/receive.css';

/* ----------------------------- RECEIVE ------------------------------ */
/**
 * One screen for every address the wallet holds, laid out like Send: the network first (a card
 * opening every network with an address, grouped by the address they share — NetworkPicker), then
 * what to give the sender: the QR with the network's mark at its centre (on the canvas, no box
 * around it), the whole address, copy and share; off Stellar a note that only this network's
 * assets arrive here. On a PC window the QR stands beside the address.
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

  // Only networks the wallet has an address on, in its mode: a family this build cannot derive,
  // or a network without a test network in test mode, is not offered.
  const offered = useMemo(() => NETWORK_IDS.filter((id) => !!addressOn(id)), [addressOn]);
  const def = NETWORKS[net];
  const name = store.networkName(net);
  const addr = addressOn(net) ?? '';

  // The card's second line: how many networks this address serves, or the coin it receives.
  const subOf = (id: NetworkId) => {
    const group = NETWORK_GROUPS.find((g) => g.networks.includes(id));
    const n = group ? group.networks.filter((x) => offered.includes(x)).length : 1;
    return n > 1 ? t('receive.sameAddrN', { n }) : t('receive.coinLine', { coin: NETWORKS[id].coin });
  };

  useEffect(() => {
    setQr('');
    if (!addr) return;
    // Stellar encodes a SEP-7 payment request so other Stellar wallets pre-fill the send. The
    // other networks get the bare address: it is what every wallet on those chains scans. `H`:
    // the network's mark covers the centre.
    qrDataUrl(net === 'stellar' ? buildSep7Pay({ destination: addr }) : addr, 'H')
      .then(setQr)
      .catch(() => {});
  }, [net, addr]);

  const label = t('receive.addrOn', { network: name });
  const share = async () => {
    // Native share sheet, Web Share, or — when neither exists — the clipboard.
    if (!(await shareText(addr, label))) void copy(addr);
  };

  return (
    <div className="scr screen col pb-24 receive">
      <ScreenHeader title={t('receive.title')} desc={t('receive.descShort')} onBack={store.goBack} />

      <SendSection label={t('receive.network')}>
        <NetworkPicker nameOf={store.networkName} value={net} onPick={setNet} networks={offered} variant="card" subOf={subOf} t={t} />
      </SendSection>

      <div key={net} className="receive-body">
        <div className="receive-qr">
          {qr ? (
            <>
              <img src={qr} width="240" height="240" alt={t('receive.qrAlt', { network: label })} className="receive-qr-img" />
              <span className="receive-qr-mark" aria-hidden="true">
                <NetworkLogo network={net} size={44} />
              </span>
            </>
          ) : (
            <Spinner tone="text" />
          )}
        </div>

        <div className="receive-details">
          <div className="receive-addr">
            <span className="receive-addr-label">{label}</span>
            <span className="receive-addr-value">{addr}</span>
          </div>

          <div className="receive-actions">
            <PrimaryButton onClick={() => void copy(addr)}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? t('common.copied') : t('common.copy')}
            </PrimaryButton>
            <GhostButton onClick={() => void share()}>{t('common.share')}</GhostButton>
          </div>

          {/* What arrives here: this network's assets only — said plainly, not as an error. */}
          {net !== 'stellar' && (
            <Notice className="receive-note">
              {t(def.address === 'evm' ? 'receive.onlyThisNetworkEvm' : 'receive.onlyThisNetwork', { chain: name })}
            </Notice>
          )}

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
    </div>
  );
}
