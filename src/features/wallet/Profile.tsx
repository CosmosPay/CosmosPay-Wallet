import { useRef, type ReactNode } from 'react';
import type { WalletStore } from '@/state/store';
import { buildKind } from '@/lib/platform';
import { shortAddr } from '@/lib/format';
import { useCopied } from '@/hooks/useCopied';
import { cx } from '@/lib/cx';
import { BackCircle } from '@/features/wallet/BackCircle';
import {
  AccountIcon,
  ActivityIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  CosmosMark,
  GearIcon,
  InfoCircleIcon,
  LinkIcon,
  PowerIcon,
  ShieldIcon,
  WalletIcon,
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

/** One row of a list: a ringed icon, its name (and a line under it), a chevron. */
function MoreRow({ icon, title, desc, onClick }: { icon: ReactNode; title: string; desc?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="more-row">
      <span className="more-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="more-row-text">
        <span className="more-row-title">{title}</span>
        {desc && <span className="more-row-desc">{desc}</span>}
      </span>
      <ChevronRightIcon className="more-row-chev" />
    </button>
  );
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
      <header className="more-head">
        <h1 className="more-title">{t('tab.more')}</h1>
        {/* In the extension there is no bar: the corner button goes back. */}
        {buildKind() === 'ext' && <BackCircle store={store} />}
      </header>

      <section className="more-person" aria-label={t('profile.accountDetails')}>
        <button type="button" onClick={() => fileRef.current?.click()} className="more-avatar" aria-label={t('profile.changePhoto')}>
          {avatar ? <img src={avatar} alt="" className="more-avatar-img" /> : <CosmosMark className="more-avatar-mark" />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden-input" />
        <div className="more-person-text">
          <span className="more-name">{name}</span>
          {store.meta?.email && <span className="more-email">{store.meta.email}</span>}
          <span className="more-addr">
            {shortAddr(pub, 6, 6)}
            <button
              type="button"
              onClick={() => void copy(pub)}
              className={cx('more-copy', copied && 'is-copied')}
              aria-label={copied ? t('common.copied') : t('profile.copyAddress')}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </span>
        </div>
      </section>

      <section className="more-section" aria-labelledby="more-account">
        <h2 id="more-account" className="more-section-title">
          {t('more.account')}
        </h2>
        <MoreRow icon={<AccountIcon />} title={t('profile.editProfile')} onClick={() => store.setScreen('edit-profile')} />
        <MoreRow
          icon={<WalletIcon />}
          title={t('profile.myWallets')}
          desc={t('wallets.onDevice', { n: store.wallets.length })}
          onClick={() => store.go('wallets', 'wallet')}
        />
        {!!store.meta?.email && (
          <MoreRow icon={<LinkIcon />} title={t('cosmospay.manage')} onClick={() => store.setScreen('cosmospay')} />
        )}
      </section>

      <section className="more-section" aria-labelledby="more-security">
        <h2 id="more-security" className="more-section-title">
          {t('more.security')}
        </h2>
        <MoreRow
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
        <MoreRow icon={<GearIcon />} title={t('profile.settings')} desc={t('more.settingsDesc')} onClick={() => store.setScreen('settings')} />
        <MoreRow icon={<ActivityIcon />} title={t('history.title')} onClick={() => store.setScreen('history')} />
        <MoreRow icon={<InfoCircleIcon />} title={t('profile.about')} onClick={() => store.setScreen('about')} />
      </section>

      <button type="button" onClick={() => store.lock()} className="more-lock">
        <PowerIcon />
        {t('profile.lock')}
      </button>
    </div>
  );
}
