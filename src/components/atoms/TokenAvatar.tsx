import '@/styles/components/token-avatar.css';

/** Coloured circular token badge. */
export function TokenAvatar({
  glyph,
  color,
  size = 38,
}: {
  glyph: string;
  color: string;
  size?: number;
}) {
  return (
    <div
      className="token-avatar"
      style={{
        // size + colour come from props; the static shell lives in token-avatar.css
        width: `${size}px`,
        height: `${size}px`,
        background: color,
        fontSize: `${Math.round(size * 0.46)}px`,
      }}
    >
      {glyph}
    </div>
  );
}
