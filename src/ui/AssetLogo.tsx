import { ASSET_META } from '@/constants/assets';
import type { NetworkId } from '@/constants/networks';
import { networkLogoUrl, tokenLogoUrl } from '@/lib/logos';
import { TokenAvatar, type TokenAvatarSize } from '@/ui/TokenAvatar';
import '@/styles/ui/asset-logo.css';

export function assetMeta(code: string) {
  // Defensive: an unknown/empty code (e.g. a liquidity-pool balance with no asset_code)
  // must not crash on .slice — fall back to a neutral glyph.
  return ASSET_META[code] || { name: code || '?', glyph: (code || '?').slice(0, 1), tone: 'base' as const };
}

/** The asset's own official logo (`lib/logos.ts`); a code with none falls back to its glyph ring.
 *  `size` drives the img's width/height ATTRIBUTES (not a style) and, on the fallback path,
 *  picks the matching .token-avatar--<px> class. Decorative: its name is always beside it. */
export function AssetLogo({ code, size = 34 }: { code: string; size?: TokenAvatarSize }) {
  const src = tokenLogoUrl(code);
  if (src) return <img src={src} width={size} height={size} alt="" loading="lazy" decoding="async" className="asset-logo" />;
  const m = assetMeta(code);
  return <TokenAvatar glyph={m.glyph} tone={m.tone} size={size} />;
}

/** The network's own mark — Base is Base, not ETH. Decorative like AssetLogo. */
export function NetworkLogo({ network, size = 34 }: { network: NetworkId; size?: TokenAvatarSize }) {
  return <img src={networkLogoUrl(network)} width={size} height={size} alt="" loading="lazy" decoding="async" className="asset-logo" />;
}
