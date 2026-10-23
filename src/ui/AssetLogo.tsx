import { ASSET_META, CHAIN_LOGO_FILES, TOKEN_LOGO_FILES } from '@/constants/assets';
import type { OtherChain } from '@/constants/chains';
import { TokenAvatar, type TokenAvatarSize } from '@/ui/TokenAvatar';
import { cx } from '@/lib/cx';
import '@/styles/ui/asset-logo.css';

export function assetMeta(code: string) {
  // Defensive: an unknown/empty code (e.g. a liquidity-pool balance with no asset_code)
  // must not crash on .slice — fall back to a neutral glyph.
  return ASSET_META[code] || { name: code || '?', glyph: (code || '?').slice(0, 1), tone: 'base' as const };
}

const publicFile = (dir: string, file: string) => `${import.meta.env.BASE_URL}${dir}/${file}`;

/**
 * An asset's colour logo (falls back to a glyph circle for an unknown code), with an
 * optional network badge in its corner. `size` drives the image's width/height ATTRIBUTES
 * and picks the matching `.asset-logo--<px>` class — never a style.
 *
 * `chain` names the network a holding lives on; the badge is drawn only when it adds
 * something — not for a chain's own native coin (BTC on Bitcoin, SOL on Solana), where it
 * would repeat the logo it sits on.
 */
export function AssetLogo({
  code,
  size = 34,
  chain,
  className,
}: {
  code: string;
  size?: TokenAvatarSize;
  chain?: 'stellar' | OtherChain;
  className?: string;
}) {
  const file = TOKEN_LOGO_FILES[code];
  const badge = chain && CHAIN_LOGO_FILES[chain] !== file ? CHAIN_LOGO_FILES[chain] : null;
  const m = assetMeta(code);
  return (
    <span className={cx('asset-logo', `asset-logo--${size}`, className)}>
      {file ? (
        <img
          src={publicFile('tokens', file)}
          width={size}
          height={size}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="asset-logo-img"
        />
      ) : (
        <TokenAvatar glyph={m.glyph} tone={m.tone} size={size} />
      )}
      {badge && (
        <img src={publicFile('tokens', badge)} alt="" draggable={false} decoding="async" className="asset-logo-badge" />
      )}
    </span>
  );
}
