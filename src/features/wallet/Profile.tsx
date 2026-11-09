import { useRef } from 'react';
import type { WalletStore } from '@/state/store';
import { shortAddr } from '@/lib/format';
import { useCopied } from '@/hooks/useCopied';
import { cx } from '@/lib/cx';
import { HomeNetworkButton } from '@/features/wallet/HomeNetworkButton';
import { ListRow } from '@/ui/ListRow';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { addressOn } from '@/lib/accountAddress';
import {
  AccountIcon,
  ActivityIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  KeyIcon,
  PlusIcon,
  ReceiveIcon,
  GearIcon,
  InfoCircleIcon,
  LinkIcon,
  PowerIcon,
  ShieldIcon,
} from '@/ui/Icons';
import '@/styles/features/wallet/profile.css';

/** Center-crop + downscale an image file to a small JPEG data URL for the avatar. */
function resizeToDataUrl(file: File, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no ctx'));
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('bad image'));
    img.src = URL.createObjectURL(file);
  });
}

/* ------------------------------- MORE -------------------------------- */
/**
 * The bar's "More" (Figma): the person — photo, name, email, the active wallet's address —
 * then everything that is not a daily action, in short lists between lines.
 */
export function Profile({ store }: { store: WalletStore }) {
  const t = store.t;
  const pub = store.publicKey ?? '';
  const name = store.meta?.name || t('addWallet.defaultName', { n: 1 });
  const avatar = store.meta?.avatar;
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, copy] = useCopied();

  const onFile = async (e: { target: HTMLInputElement }) => {
    const f = e.target.files?.[0];
    if (f) {
      try {
        await store.setWalletAvatar(await resizeToDataUrl(f));
      } catch {
        /* not an image the browser can read: nothing changes */
      }
    }
    e.target.value = '';
  };

  return (
    <div className="scr screen pb-110 more">
      <ScreenHeader title={t('profile.title')} onBack={store.goBack} />

      <section className="more-person" aria-label={t('profile.accountDetails')}>
        <button type="button" onClick={() => fileRef.current?.click()} className="more-avatar" aria-label={t('profile.changePhoto')}>
          {avatar ? <img src={avatar} alt="" className="more-avatar-img" /> : <span className="more-avatar-initial" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase()}</span>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden-input" />
        <div className="more-person-text">
          <h2 className="more-name" title={name}>{name}</h2>
          {store.meta?.email && <span className="more-email">{store.meta.email}</span>}
          <button
            type="button"
            onClick={() => void copy(pub)}
            disabled={!pub}
            className={cx('more-address', copied && 'is-copied')}
            aria-label={copied ? t('common.copied') : t('profile.copyAddress')}
            title={pub}
          >
            <span>{shortAddr(pub, 6, 6) || '—'}</span>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <span className="sr-only" role="status">{copied ? t('common.copied') : ''}</span>
          <HomeNetworkButton store={store} />
        </div>
      </section>

      <section className="more-section more-wallets" aria-labelledby="more-wallets">
        <div className="more-section-heading">
          <h2 id="more-wallets" className="more-section-title">{t('profile.myWallets')}</h2>
          <span className="more-count">{store.wallets.length}</span>
        </div>
        <ul className="more-wallet-list">
          {store.wallets.map((wallet) => {
            const active = wallet.id === store.activeWalletId;
            return (
              <li key={wallet.id}>
                <button
                  type="button"
                  className={cx('more-wallet', active && 'is-active')}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => active ? store.go('wallets', 'wallet') : void store.switchWallet(wallet.id)}
                >
                  <span className="more-wallet-initial" aria-hidden="true">{wallet.name.trim().slice(0, 1).toUpperCase()}</span>
                  <span className="more-wallet-text">
                    <span className="more-wallet-name">{wallet.name}</span>
                    <span className="more-wallet-address">{shortAddr(addressOn(wallet, store.network.passphrase), 6, 6)}</span>
                  </span>
                  {active && <span className="more-wallet-active"><CheckIcon />{t('profile.active')}</span>}
                  <ChevronRightIcon className="more-wallet-chevron" />
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="more-add-wallet" onClick={() => store.setScreen('add-wallet')}>
          <span className="more-add-icon" aria-hidden="true"><PlusIcon /></span>
          <span>{t('profile.addWallet')}</span>
          <ChevronRightIcon className="more-wallet-chevron" />
        </button>
      </section>

      <section className="more-section" aria-labelledby="more-account">
        <h2 id="more-account" className="more-section-title">
          {t('more.account')}
        </h2>
        <ListRow icon={<AccountIcon />} title={t('profile.editProfile')} onClick={() => store.setScreen('edit-profile')} />
        <ListRow icon={<ReceiveIcon />} title={t('profile.receiveAddr')} onClick={() => { store.setReceiveNet('stellar'); store.setScreen('receive'); }} />
        {!!store.meta?.email && (
          <ListRow icon={<LinkIcon />} title={t('cosmospay.manage')} onClick={() => store.setScreen('cosmospay')} />
        )}
      </section>

      <section className="more-section" aria-labelledby="more-security">
        <h2 id="more-security" className="more-section-title">
          {t('more.security')}
        </h2>
        <ListRow icon={<KeyIcon />} title={t('profile.exportKeys')} onClick={() => store.setScreen('export')} />
        <ListRow
          icon={<ShieldIcon />}
          title={t('more.securityRow')}
          desc={t('more.securityDesc')}
          onClick={() => store.setScreen('settings')}
        />
      </section>

      <section className="more-section" aria-labelledby="more-app">
        <h2 id="more-app" className="more-section-title">
          {t('more.app')}
        </h2>
        <ListRow icon={<GearIcon />} title={t('profile.settings')} desc={t('more.settingsDesc')} onClick={() => store.setScreen('settings')} />
        <ListRow icon={<ActivityIcon />} title={t('history.title')} onClick={() => store.setScreen('history')} />
        <ListRow icon={<InfoCircleIcon />} title={t('profile.about')} onClick={() => store.setScreen('about')} />
      </section>

      <button type="button" onClick={() => store.lock()} className="more-lock">
        <PowerIcon />
        {t('profile.lock')}
      </button>
    </div>
  );
}
