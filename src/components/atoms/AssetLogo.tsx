import { ASSET_ICONS } from '@/components/assetIcons';
import { ASSET_META, AV } from '@/constants/assets';
import { TokenAvatar } from './TokenAvatar';
import '@/styles/components/asset-logo.css';

export function assetMeta(code: string) {
  // Defensive: an unknown/empty code (e.g. a liquidity-pool balance with no asset_code)
  // must not crash on .slice — fall back to a neutral glyph.
  return ASSET_META[code] || { name: code || '?', glyph: (code || '?').slice(0, 1), color: AV };
}

/** Official monochrome asset logo (falls back to a glyph circle for unknown codes). */
export function AssetLogo({ code, size = 34 }: { code: string; size?: number }) {
  const icon = ASSET_ICONS[code];
  if (icon) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className="asset-logo">
        <path d={icon.d} fill="currentColor" fillRule={icon.evenodd ? 'evenodd' : 'nonzero'} />
      </svg>
    );
  }
  const m = assetMeta(code);
  return <TokenAvatar glyph={m.glyph} color={m.color} size={size} />;
}
