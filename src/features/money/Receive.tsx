import { useEffect, useState } from 'react';
import type { WalletStore } from '@/state/store';
import { AssetLogo } from '@/ui/AssetLogo';
import { BackBar } from '@/ui/BackBar';
import { Spinner } from '@/ui/Spinner';
import { qrDataUrl } from '@/lib/qr';
import { buildSep7Pay } from '@/lib/sep7';
import { shareText } from '@/lib/share';
import { useCopied } from '@/hooks/useCopied';
import { cx } from '@/lib/cx';
import type { CrossChainNetwork } from '@/lib/cosmospay';
import '@/styles/features/money/receive.css';

const NETWORKS: readonly CrossChainNetwork[] = ['stellar', 'solana', 'monad'];
/** The coin whose logo stands for each network on the chip. */
const NATIVE_CODE: Record<CrossChainNetwork, string> = { stellar: 'XLM', solana: 'SOL', monad: 'MON' };

/* ----------------------------- RECEIVE ------------------------------ */
/**
 * One screen for every address the wallet holds: Stellar, and the Solana and Monad accounts
 * the same phrase derives. Each network gets the same QR, copy and share — and a line saying
 * which assets belong there, because a token sent on the wrong network to one of these does
 * not arrive. A wallet with no phrase has only the Stellar tab.
 */
export function Receive({ store }: { store: WalletStore }) {
  const t = store.t;
  const [qr, setQr] = useState('');
  const [copied, copy] = useCopied();
  // Opens on the network the Home card asked for, once: the next visit starts from Stellar.
  const [net, setNet] = useState<CrossChainNetwork>(store.receiveNet);
  const chains = store.meta?.chainAddresses;
  const { ensureChainAddresses, setReceiveNet } = store;

  useEffect(() => {
    setReceiveNet('stellar');
  }, [setReceiveNet]);

  // The phrase's Solana and Monad addresses, derived the first time this screen opens.
  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses]);

  const stellar = store.meta?.publicKey ?? '';
  const addr = net === 'stellar' ? stellar : chains?.[net] ?? '';

  useEffect(() => {
    setQr('');
    if (!addr) return;
    // Stellar encodes a SEP-0007 payment request so other Stellar wallets pre-fill the send.
    // Solana and Monad get the bare address: it is what every wallet on those chains scans.
    qrDataUrl(net === 'stellar' ? buildSep7Pay({ destination: addr }) : addr).then(setQr).catch(() => {});
  }, [net, addr]);

  const label = t(`receive.addr.${net}`);
  const share = async () => {
    // Native share sheet where there is one, Web Share in a browser that has it, clipboard
    // otherwise — `shareText` reports which, so the copy only happens when nothing else could.
    if (!(await shareText(addr, label))) copy(addr);
  };

  return (
    <div className="scr screen pb-30">
      <BackBar title={t('receive.title')} onBack={store.goBack} />

      {chains && (
        <div className="receive-tabs" role="tablist" aria-label={t('receive.network')}>
          {NETWORKS.map((n) => (
            <button key={n} role="tab" aria-selected={net === n} onClick={() => setNet(n)} className={cx('receive-tab', net === n && 'is-on')}>
              {t(`xswap.chain.${n}`)}
            </button>
          ))}
        </div>
      )}

      <div className="receive-desc">{t(`receive.desc.${net}`)}</div>
      <div className="receive-qr">
        {qr ? (
          <img src={qr} width="188" height="188" alt="QR" className="receive-qr-img" />
        ) : (
          <div className="receive-qr-ph"><Spinner tone="ink" /></div>
        )}
      </div>
      <div className="center receive-chip-wrap">
        <div className="glass-soft receive-chip">
          <AssetLogo code={NATIVE_CODE[net]} size={26} />
          <span className="receive-chip-label">{label}</span>
        </div>
      </div>
      <div className="glass row between g12 receive-addr-card">
        <div className="min0">
          <div className="receive-addr-label">{t(`receive.addrLabel.${net}`)}</div>
          <div className="receive-addr-value">{addr}</div>
        </div>
        <div onClick={() => copy(addr)} className={cx('receive-copy', copied && 'is-copied')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" /><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </div>
      </div>
      {net !== 'stellar' && <div className="receive-warn">{t('receive.onlyThisNetwork', { chain: t(`xswap.chain.${net}`) })}</div>}
      <div className="flexr g10">
        <button onClick={() => copy(addr)} className="glass-soft receive-btn">{copied ? t('common.copied') : t('common.copy')}</button>
        <button onClick={share} className="receive-btn receive-btn--share">{t('common.share')}</button>
      </div>

      {net === 'stellar' && (
        <div onClick={() => store.setScreen('paylink')} className="tap glass-soft row between receive-paylink">
          <div className="row g12">
            <div className="receive-paylink-emoji">🔗</div>
            <div>
              <div className="receive-paylink-title">{t('paylink.title')}</div>
              <div className="receive-paylink-desc">{t('paylink.entryDesc')}</div>
            </div>
          </div>
          <span className="receive-paylink-chev">›</span>
        </div>
      )}
    </div>
  );
}
