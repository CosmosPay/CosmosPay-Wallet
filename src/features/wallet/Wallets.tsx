import { useEffect } from 'react';
import type { WalletStore } from '@/state/store';
import { NetworkLogo } from '@/ui/AssetLogo';
import { NavMenu } from '@/app/NavMenu';
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  DevicesIcon,
  KeyIcon,
  PlusIcon,
  QrIcon,
  ShieldIcon,
} from '@/ui/Icons';
import { useCopied } from '@/hooks/useCopied';
import { useRecoveryReachable } from '@/hooks/useRecoveryReachable';
import { shortAddr } from '@/lib/format';
import { addressOn } from '@/lib/accountAddress';
import { buildKind } from '@/lib/platform';
import { cx } from '@/lib/cx';
import type { TFn } from '@/lib/i18n';
import { NETWORKS, NETWORK_GROUPS, type NetworkId } from '@/constants/networks';
import '@/styles/features/wallet/wallets.css';

/** The names of the networks one address serves: "Solana y Fogo", "Ethereum, Base y 14 más". */
function groupLabel(networks: readonly NetworkId[], nameOf: (id: NetworkId) => string, t: TFn): string {
  const names = networks.map(nameOf);
  if (names.length === 1) return names[0];
  if (names.length === 2) return t('wallets.groupTwo', { a: names[0], b: names[1] });
  return t('wallets.groupMore', { names: names.slice(0, 2).join(', '), n: names.length - 2 });
}

/**
 * The Wallet tab: everything about the wallet itself, so using several networks is one place.
 * The active wallet's address on each network (copy, or its QR on Receive), which Stellar
 * ledger it uses, how it is recovered, and the wallets on this device — with "add" one tap
 * away, under the same password.
 */
export function Wallets({ store }: { store: WalletStore }) {
  const t = store.t;
  const [copied, copy] = useCopied();
  const { ensureChainAddresses, loadRecovery } = store;
  const recoveryUp = useRecoveryReachable(store.network);

  useEffect(() => {
    void ensureChainAddresses();
  }, [ensureChainAddresses, store.meta?.id]);
  useEffect(() => {
    void loadRecovery();
  }, [loadRecovery, store.publicKey, store.network.id]);

  // One row per address, not per network: the sixteen EVM networks are one 0x account, and
  // saying so is what tells a person the same address works on all of them. In the wallet's
  // mode: on a test network, the networks with a test network here, by their test names.
  const netAddress = store.addressOn;
  const addresses = NETWORK_GROUPS.flatMap((g) => {
    const nets = g.networks.filter((id) => !!netAddress(id));
    const net = nets[0];
    const address = net ? netAddress(net) : null;
    if (!net || !address) return [];
    const label = net === 'stellar' ? `Stellar · ${store.network.label}` : groupLabel(nets, store.networkName, t);
    return [{ net, kind: g.kind, label, address }];
  });
  const showQr = (net: NetworkId) => {
    store.setReceiveNet(net);
    store.setScreen('receive');
  };

  const rec = store.recovery;
  const recoveryLine = !rec
    ? t('wallets.recoveryChecking')
    : rec.enabled
      ? t('wallets.recoveryOn', { email: store.meta?.recoveryEmail || store.meta?.email || '' })
      : !rec.exists
        ? t('wallets.recoveryNotFunded')
        : recoveryUp === false
          ? t('wallets.recoveryUnavailable')
          : t('wallets.recoveryOff');

  return (
    <div className="scr screen pb-110 wallets">
      <header className="wallets-head">
        <h1 className="wallets-title">{t('tab.wallet')}</h1>
        {buildKind() === 'ext' && <NavMenu store={store} />}
      </header>

      {/* ---- the active wallet, on every network ---- */}
      <section className="wallets-section" aria-labelledby="wallets-active">
        <div className="wallets-section-head">
          <h2 id="wallets-active" className="wallets-name">
            {store.meta?.name}
          </h2>
          <span className="wallets-badge">{t('profile.active')}</span>
        </div>
        <div className="wallets-addresses">
          {addresses.map((a) => (
            <div key={a.kind} className="wallets-addr">
              <NetworkLogo network={a.net} size={34} />
              <div className="wallets-addr-main">
                <span className="wallets-addr-net">{a.label}</span>
                <span className="wallets-addr-value">{shortAddr(a.address, 6, 6)}</span>
              </div>
              <button
                type="button"
                onClick={() => void copy(a.address, a.net)}
                className={cx('wallets-icon-btn', copied === a.net && 'is-done')}
                aria-label={copied === a.net ? t('common.copied') : t('wallets.copyOn', { network: a.label })}
              >
                {copied === a.net ? <CheckIcon /> : <CopyIcon />}
              </button>
              <button type="button" onClick={() => showQr(a.net)} className="wallets-icon-btn" aria-label={t('wallets.qrOn', { network: a.label })}>
                <QrIcon />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ---- the Stellar ledger ---- */}
      <section className="wallets-section" aria-labelledby="wallets-ledger">
        <h2 id="wallets-ledger" className="wallets-section-title">
          {t('wallets.ledger')}
        </h2>
        <div role="radiogroup" aria-labelledby="wallets-ledger" className="wallets-list">
          {store.networks.map((n) => {
            const on = n.id === store.network.id;
            return (
              <button
                key={n.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => void store.switchNetwork(n.id)}
                className={cx('wallets-row', on && 'is-on')}
              >
                <span className="wallets-row-text">{n.label}</span>
                <span className="wallets-radio" aria-hidden="true">
                  {on && <CheckIcon />}
                </span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => store.setScreen('add-network')} className="link-btn wallets-link">
          {t('wallets.addNetwork')}
        </button>
      </section>

      {/* ---- recovering the account ---- */}
      <section className="wallets-section" aria-labelledby="wallets-recovery">
        <h2 id="wallets-recovery" className="wallets-section-title">
          {t('wallets.recovery')}
        </h2>
        <div className="wallets-list">
          <button
            type="button"
            onClick={() => {
              store.setScreen('settings');
              store.replaceStep('recovery');
            }}
            className="wallets-row"
          >
            <span className={cx('wallets-row-icon', rec?.enabled && 'is-on')} aria-hidden="true">
              <ShieldIcon />
            </span>
            <span className="wallets-row-text">
              <span className="wallets-row-title">{t('wallets.recoveryTitle')}</span>
              <span className="wallets-row-desc">{recoveryLine}</span>
            </span>
            <ChevronRightIcon className="wallets-chev" />
          </button>
          <button type="button" onClick={() => store.setScreen('easy-recovery-send')} className="wallets-row">
            <span className="wallets-row-icon" aria-hidden="true">
              <DevicesIcon />
            </span>
            <span className="wallets-row-text">
              <span className="wallets-row-title">{t('wallets.transfer')}</span>
              <span className="wallets-row-desc">{t('wallets.transferDesc')}</span>
            </span>
            <ChevronRightIcon className="wallets-chev" />
          </button>
          <button type="button" onClick={() => store.setScreen('export')} className="wallets-row">
            <span className="wallets-row-icon" aria-hidden="true">
              <KeyIcon />
            </span>
            <span className="wallets-row-text">
              <span className="wallets-row-title">{t('wallets.phrase')}</span>
              <span className="wallets-row-desc">{t('wallets.phraseDesc')}</span>
            </span>
            <ChevronRightIcon className="wallets-chev" />
          </button>
        </div>
      </section>

      {/* ---- the wallets on this device ---- */}
      <section className="wallets-section" aria-labelledby="wallets-device">
        <h2 id="wallets-device" className="wallets-section-title">
          {t('wallets.onDevice', { n: store.wallets.length })}
        </h2>
        <div className="wallets-list">
          {store.wallets.map((w) => {
            const active = w.id === store.activeWalletId;
            return (
              <button
                key={w.id}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => !active && void store.switchWallet(w.id)}
                className={cx('wallets-row', active && 'is-on')}
              >
                <span className="wallets-initial" aria-hidden="true">
                  {w.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="wallets-row-text">
                  <span className="wallets-row-title">{w.name}</span>
                  <span className="wallets-row-desc">{shortAddr(addressOn(w, store.network.passphrase), 6, 6)}</span>
                </span>
                {active ? (
                  <span className="wallets-badge">{t('profile.active')}</span>
                ) : (
                  <span className="wallets-use">{t('profile.switch')}</span>
                )}
              </button>
            );
          })}
          <button type="button" onClick={() => store.setScreen('add-wallet')} className="wallets-row">
            <span className="wallets-initial is-add" aria-hidden="true">
              <PlusIcon />
            </span>
            <span className="wallets-row-text">
              <span className="wallets-row-title">{t('profile.addWallet')}</span>
              <span className="wallets-row-desc">{t('wallets.addDesc')}</span>
            </span>
            <ChevronRightIcon className="wallets-chev" />
          </button>
        </div>
      </section>
    </div>
  );
}
