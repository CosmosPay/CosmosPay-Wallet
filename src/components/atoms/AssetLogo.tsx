import { ASSET_ICONS } from '@/components/assetIcons';
import { ASSET_META } from '@/constants/assets';
import { TokenAvatar, type TokenAvatarSize } from './TokenAvatar';
import '@/styles/components/asset-logo.css';

export function assetMeta(code: string) {
  // Defensive: an unknown/empty code (e.g. a liquidity-pool balance with no asset_code)
  // must not crash on .slice — fall back to a neutral glyph.
  return ASSET_META[code] || { name: code || '?', glyph: (code || '?').slice(0, 1), tone: 'base' as const };
}

/** Official monochrome asset logo (falls back to a glyph circle for unknown codes).
 *  `size` drives the svg's width/height ATTRIBUTES (not a style) and, on the
 *  fallback path, picks the matching .token-avatar--<px> class. */
export function AssetLogo({ code, size = 34 }: { code: string; size?: TokenAvatarSize }) {
  const icon = ASSET_ICONS[code];
  if (icon) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className="asset-logo">
        <path d={icon.d} fill="currentColor" fillRule={icon.evenodd ? 'evenodd' : 'nonzero'} />
      </svg>
    );
  }
  const m = assetMeta(code);
  return <TokenAvatar glyph={m.glyph} tone={m.tone} size={size} />;
}
