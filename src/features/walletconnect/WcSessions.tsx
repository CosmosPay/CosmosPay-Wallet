import type { WalletStore } from '@/state/store';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { evmDappChain } from '@/lib/evmDapp';
import { networkNameOn } from '@/lib/testnets';
import { shortAddr } from '@/lib/format';
import { cx } from '@/lib/cx';
import { GhostButton } from '@/ui/Buttons';
import '@/styles/features/walletconnect/wc-sessions.css';

/**
 * The sites connected with WalletConnect, in Settings next to the sites the extension or the web
 * provider granted (`ConnectedSites.tsx`) — a separate grant, listed and revoked on its own. Each
 * says which account it was approved for; one approved for another wallet or the other mode is
 * marked, since it cannot sign until the wallet is back there. Hidden on a build without a
 * project id.
 */
export function WcSessions({ store }: { store: WalletStore }) {
  const t = store.t;
  if (!store.wcEnabled) return null;
  const sessions = store.wcSessions;
  const chainName = (id: number) => {
    const c = evmDappChain(store.chainNet, id);
    return c ? networkNameOn(c.network, store.chainNet) : String(id);
  };
  return (
    <SettingsSection title={t('wc.sessionsTitle')}>
      <p className="desc wc-sessions-desc">{t('wc.sessionsDesc')}</p>
      {!sessions.length ? (
        <div className="wc-sessions-empty">{t('wc.sessionsNone')}</div>
      ) : (
        sessions.map((s, i) => (
          <div key={s.topic} className={cx('row between g12 wc-sessions-row', i === sessions.length - 1 && 'is-last')}>
            <div className="min0 col wc-sessions-text">
              <span className="wc-sessions-name">{s.peer.name || s.peer.host}</span>
              <span className="wc-sessions-sub">
                {[s.peer.host, s.account ? shortAddr(s.account, 6, 4) : null, s.current ? s.chains.map(chainName).join(', ') : t('wc.otherWallet')]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <button type="button" onClick={() => void store.wcDisconnect(s.topic)} className="wc-sessions-revoke">
              {t('wc.disconnect')}
            </button>
          </div>
        ))
      )}
      <GhostButton onClick={() => store.setScreen('wc-pair')} className="wc-sessions-add">
        {t('wc.connectSite')}
      </GhostButton>
    </SettingsSection>
  );
}
