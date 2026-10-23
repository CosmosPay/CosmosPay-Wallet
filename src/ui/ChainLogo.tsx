import { CHAIN_LOGO_FILES } from '@/constants/assets';
import type { OtherChain } from '@/constants/chains';
import type { TokenAvatarSize } from '@/ui/TokenAvatar';
import { cx } from '@/lib/cx';
import '@/styles/ui/asset-logo.css';

/** A NETWORK's mark (Arbitrum's, Base's, …) — where `AssetLogo` draws a coin. Same sizes,
 *  same sheet, so a network chip and a token row line up. */
export function ChainLogo({ chain, size = 28, className }: { chain: 'stellar' | OtherChain; size?: TokenAvatarSize; className?: string }) {
  return (
    <span className={cx('asset-logo', `asset-logo--${size}`, className)}>
      <img
        src={`${import.meta.env.BASE_URL}tokens/${CHAIN_LOGO_FILES[chain]}`}
        width={size}
        height={size}
        alt=""
        draggable={false}
        decoding="async"
        className="asset-logo-img"
      />
    </span>
  );
}
