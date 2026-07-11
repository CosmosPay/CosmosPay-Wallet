/** Visual metadata for the assets we know about. */
// Monochrome palette: token circles are neutral; the glyph carries the identity.
export const AV = 'var(--avatar-bg)';
export const AV_BRAND = 'var(--avatar-brand)';

export const ASSET_META: Record<string, { name: string; glyph: string; color: string }> = {
  XLM: { name: 'Stellar Lumens', glyph: '✦', color: AV_BRAND },
  USDC: { name: 'USD Coin', glyph: '$', color: AV },
  USDB: { name: 'USD BlindPay', glyph: '$', color: AV },
  EURC: { name: 'Euro Coin', glyph: '€', color: AV },
  yXLM: { name: 'yieldXLM', glyph: 'y', color: AV },
  AQUA: { name: 'Aquarius', glyph: 'A', color: AV },
};
