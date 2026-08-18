import '@/styles/ui/token-avatar.css';
// The tone union lives with the table that assigns it — see constants/assets.ts.
export type { TokenAvatarTone } from '@/constants/assets';
import type { TokenAvatarTone } from '@/constants/assets';

/** Diameters that have a .token-avatar--<px> class in token-avatar.css.
 *  Widen this union (and add the class) rather than passing a raw number. */
export type TokenAvatarSize = 20 | 24 | 26 | 28 | 34 | 36 | 38 | 64;

/** Coloured circular token badge. */
export function TokenAvatar({
  glyph,
  tone = 'base',
  size = 38,
}: {
  glyph: string;
  tone?: TokenAvatarTone;
  size?: TokenAvatarSize;
}) {
  return (
    <div className={`token-avatar token-avatar--${tone} token-avatar--${size}`}>{glyph}</div>
  );
}
