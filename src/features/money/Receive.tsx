import { useEffect, useId, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { AssetLogo } from '@/ui/AssetLogo';
import { GhostButton, PrimaryButton } from '@/ui/Buttons';
import { CheckIcon, ChevronRightIcon, CopyIcon, LinkIcon } from '@/ui/Icons';
import { Notice } from '@/ui/Notice';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { Spinner } from '@/ui/Spinner';
import { Tabs } from '@/ui/Tabs';
import { qrDataUrl } from '@/lib/qr';
import { buildSep7Pay } from '@/lib/sep7';
import { shareText } from '@/lib/share';
import { useCopied } from '@/hooks/useCopied';
import type { CrossChainNetwork } from '@/lib/cosmospay';
import '@/styles/features/money/receive.css';

const NETWORKS: readonly CrossChainNetwork[] = ['stellar', 'solana', 'monad'];
/** The coin that names each network. */
const NATIVE_CODE: Record<CrossChainNetwork, string> = { stellar: 'XLM', solana: 'SOL', monad: 'MON' };

/* ----------------------------- RECEIVE ------------------------------ */
/**
 * One screen for every address the wallet holds: Stellar, and the Solana and Monad accounts
 * the same phrase derives, one tab each. Each has its QR (on the canvas, no box around it), its
 * address to copy or share, and — off Stellar — a warning, because a token sent on the wrong
 * network to one of these does not arrive. A wallet with no phrase has Stellar only.
 */
export function Receive({ store }: { store: WalletStore }) {
  const t = store.t;
  const [qr, setQr] = useState('');
  const [copied, copy] = useCopied();
  // Opens on the network the caller asked for (the Wallet tab's QR), once.
  const [net, setNet] = useState<CrossChainNetwork>(store.receiveNet);
  const chains = store.meta?.chainAddresses;
  const { ensureChainAddresses, setReceiveNet } = store;
  const panelId = useId();

  useEffect(() => {
    setReceiveNet('stellar');
  }, [setReceiveNet]);
  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  const stellar = store.publicKey ?? '';
  const addr = net === 'stellar' ? stellar : chains?.[net] ?? '';

  useEffect(() => {
    setQr('');
    if (!addr) return;
    // Stellar encodes a SEP-7 payment request so other Stellar wallets pre-fill the send.
    // Solana and Monad get the bare address: it is what every wallet on those chains scans.
    qrDataUrl(net === 'stellar' ? buildSep7Pay({ destination: addr }) : addr)
      .then(setQr)
      .catch(() => {});
  }, [net, addr]);

  const label = t(`receive.addr.${net}`);
  const share = async () => {
    // Native share sheet, Web Share, or — when neither exists — the clipboard.
    if (!(await shareText(addr, label))) void copy(addr);
  };

  return (
    <div className="scr screen col pb-24">
      <ScreenHeader title={t('receive.title')} desc={t(`receive.desc.${net}`)} onBack={store.goBack} />

      {chains && (
        <Tabs
          tabs={NETWORKS.map((n) => ({ key: n, label: t(`xswap.chain.${n}`) }))}
          value={net}
          onChange={setNet}
          label={t('receive.network')}
          panelId={panelId}
          className="receive-tabs"
        />
      )}

      <div id={panelId} role="tabpanel" className="receive-panel">
        <div className="receive-qr">
          {qr ? <img src={qr} width="220" height="220" alt={t('receive.qrAlt', { network: label })} className="receive-qr-img" /> : <Spinner tone="text" />}
        </div>

        <div className="receive-addr">
          <AssetLogo code={NATIVE_CODE[net]} size={34} />
          <div className="receive-addr-main">
            <span className="receive-addr-label">{t(`receive.addrLabel.${net}`)}</span>
            <span className="receive-addr-value">{addr}</span>
          </div>
        </div>

        {net !== 'stellar' && (
          <Notice tone="danger" className="receive-warn">
            {t('receive.onlyThisNetwork', { chain: t(`xswap.chain.${net}`) })}
          </Notice>
        )}

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
