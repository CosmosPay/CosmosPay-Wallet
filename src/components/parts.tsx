/** Shared UI primitives — faithful to the Cosmos design system. */
import type { ReactNode, CSSProperties } from 'react';
import type { WalletStore } from './store';

// Colours come from CSS variables (see src/pages/index.astro) so the whole UI
// re-themes instantly when `data-theme` flips between dark and light.
export const C = {
  bg: 'var(--bg)',
  accent: 'var(--accent)',
  onAccent: 'var(--on-accent)',
  ink: 'var(--text)',
  inkSoft: 'var(--text-soft)',
  muted: 'var(--muted)',
  dim: 'var(--dim)',
  dimmer: 'var(--dimmer)',
  card: 'var(--surface-2)',
  cardSolid: 'var(--glass-soft-bg)',
  cardBorder: 'var(--glass-border)',
  hairline: 'var(--hairline)',
  surface: 'var(--surface)',
  danger: '#ff5d5d',
  // ---- glassmorphism system ----
  // Standard frosted card: translucent, blurred, hairline border + top highlight.
  glass: {
    background: 'var(--glass-bg)',
    backdropFilter: 'blur(22px) saturate(150%)',
    WebkitBackdropFilter: 'blur(22px) saturate(150%)',
    border: '1px solid var(--glass-border)',
    boxShadow: 'inset 0 1px 0 var(--glass-border), 0 10px 30px rgba(0,0,0,.28)',
    animation: 'glassBreath 8s ease-in-out infinite',
  } as CSSProperties,
  // Lighter glass for chips / circular buttons / keypad / small surfaces.
  glassSoft: {
    background: 'var(--glass-soft-bg)',
    backdropFilter: 'blur(16px) saturate(140%)',
    WebkitBackdropFilter: 'blur(16px) saturate(140%)',
    border: '1px solid var(--glass-soft-border)',
    animation: 'glassBreath 11s ease-in-out infinite',
  } as CSSProperties,
  // Solid CTA: white-on-dark (dark theme) / dark-on-white (light theme).
  glassBright: {
    background: 'var(--primary-bg)',
    backdropFilter: 'blur(20px) saturate(160%)',
    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
    border: '1px solid var(--primary-border)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.28), 0 12px 30px rgba(0,0,0,.30)',
  } as CSSProperties,
};

/** Brand logo (white asset; CSS inverts it to black in light mode). No frame. */
export function Logo({ size = 72 }: { size?: number }) {
  return (
    <img
      src="/logo-white.png"
      className="brand-logo"
      width={size}
      height={size}
      alt="Cosmos"
      draggable={false}
      style={{ display: 'block', objectFit: 'contain', userSelect: 'none' }}
    />
  );
}

/** The phone column with the signature glow + blurred blobs. */
export function Shell({
  children,
  showGlow = true,
  showNav = false,
  store,
}: {
  children: ReactNode;
  showGlow?: boolean;
  showNav?: boolean;
  store?: WalletStore;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        background: C.bg,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '440px',
          minHeight: '100vh',
          background: C.bg,
          overflow: 'hidden',
          color: 'var(--text)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {showGlow && (
          <div
            className="cosmos-glow"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '300px',
              background:
                'radial-gradient(120% 90% at 50% -12%, var(--glow), transparent 72%)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        )}
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <Blob anim="cosmos-blob-a" top="-70px" left="-50px" size="320px" color="var(--blob)" blur="90px" />
          <Blob anim="cosmos-blob-b" bottom="140px" right="-80px" size="300px" color="var(--blob)" blur="95px" />
          <Blob anim="cosmos-blob-c" bottom="-50px" left="-40px" size="280px" color="var(--blob)" blur="85px" />
        </div>

        <div
          style={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            zIndex: 1,
            display: 'flex',
            flexDirection: 'column',
            paddingTop: '14px',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {children}
        </div>

        {showNav && store && <BottomNav store={store} />}
      </div>
    </div>
  );
}

function Blob(p: {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  size: string;
  color: string;
  blur: string;
  anim?: string;
}) {
  return (
    <div
      className={p.anim}
      style={{
        position: 'absolute',
        top: p.top,
        bottom: p.bottom,
        left: p.left,
        right: p.right,
        width: p.size,
        height: p.size,
        borderRadius: '50%',
        background: p.color,
        filter: `blur(${p.blur})`,
      }}
    />
  );
}

export function BottomNav({ store }: { store: WalletStore }) {
  const active = store.tab;
  const col = (t: string) => (active === t ? 'var(--text)' : 'var(--dim)');
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '92px',
        zIndex: 5,
        padding: '0 24px calc(26px + env(safe-area-inset-bottom))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(24px) saturate(150%)',
        WebkitBackdropFilter: 'blur(24px) saturate(150%)',
        borderTop: '1px solid var(--hairline)',
      }}
    >
      <NavItem label={store.t('tab.home')} color={col('home')} onClick={() => store.go('home', 'home')}>
        <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </NavItem>
      <NavItem label={store.t('tab.earn')} color={col('earn')} onClick={() => store.go('earn', 'earn')}>
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.9" />
        <path d="M9 14.5l6-6M9.5 9.5h.01M14.5 14.5h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </NavItem>
      <div
        onClick={() => store.setScreen('swap')}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', transform: 'translateY(-8px)' }}
      >
        <div
          className="tap"
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '18px',
            background: C.accent,
            color: 'var(--on-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 20px rgba(0,0,0,.28)',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M7 7h11l-3-3M17 17H6l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <NavItem label={store.t('tab.markets')} color={col('markets')} onClick={() => store.go('markets', 'markets')}>
        <path d="M4 16l4-5 4 3 4-7 4 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </NavItem>
      <NavItem label={store.t('tab.profile')} color={col('profile')} onClick={() => store.go('profile', 'profile')}>
        <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.9" />
        <path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </NavItem>
    </div>
  );
}

function NavItem({
  label,
  color,
  onClick,
  children,
}: {
  label: string;
  color: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div onClick={onClick} className="tap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', cursor: 'pointer', color }}>
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none">
        {children}
      </svg>
      <span style={{ fontSize: '10px', fontWeight: 700 }}>{label}</span>
    </div>
  );
}

export function BackBar({
  title,
  onBack,
  right,
  closeIcon = false,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  closeIcon?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '6px 0 8px' }}>
      <div
        onClick={onBack}
        className="tap"
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '50%',
          ...C.glassSoft,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: closeIcon ? '17px' : '22px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {closeIcon ? '✕' : '‹'}
      </div>
      <span style={{ fontSize: '18px', fontWeight: 700, flex: 1 }}>{title}</span>
      {right}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        width: '100%',
        ...C.glassBright,
        color: 'var(--primary-text)',
        borderRadius: '16px',
        padding: '17px',
        fontSize: '16px',
        fontWeight: 800,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        ...C.glassSoft,
        color: 'var(--text)',
        borderRadius: '16px',
        padding: '18px',
        fontSize: '16px',
        fontWeight: 800,
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Numeric keypad shared by Send / Swap amount entry. */
export function NumberPad({ onKey }: { onKey: (k: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '4px 8px' }}>
      {keys.map((k) => (
        <div
          key={k}
          onClick={() => onKey(k)}
          style={{
            height: '52px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '24px',
            fontWeight: 600,
            borderRadius: '14px',
            cursor: 'pointer',
            userSelect: 'none',
            ...C.glassSoft,
          }}
        >
          {k === 'back' ? '⌫' : k}
        </div>
      ))}
    </div>
  );
}

export function Spinner({ size = 18, color = 'var(--primary-text)' }: { size?: number; color?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: `${size}px`,
        height: `${size}px`,
        border: `2px solid ${color}`,
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'spin .7s linear infinite',
        verticalAlign: 'middle',
      }}
    />
  );
}

export function Toast({ toast }: { toast: WalletStore['toast'] }) {
  if (!toast) return null;
  const bg =
    toast.kind === 'ok'
      ? 'var(--accent)'
      : toast.kind === 'err'
      ? 'rgba(210,64,64,.92)'
      : 'var(--glass-bg)';
  const fg = toast.kind === 'ok' ? 'var(--on-accent)' : toast.kind === 'err' ? '#fff' : 'var(--text)';
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'calc(108px + env(safe-area-inset-bottom))',
        transform: 'translateX(-50%)',
        zIndex: 50,
        maxWidth: '380px',
        width: 'calc(100% - 40px)',
        background: bg,
        backdropFilter: 'blur(20px) saturate(150%)',
        WebkitBackdropFilter: 'blur(20px) saturate(150%)',
        border: '1px solid rgba(255,255,255,.16)',
        color: fg,
        borderRadius: '14px',
        padding: '13px 16px',
        fontSize: '13.5px',
        fontWeight: 700,
        textAlign: 'center',
        lineHeight: 1.4,
        boxShadow: '0 12px 30px rgba(0,0,0,.4)',
        animation: 'fadeUp .25s ease',
      }}
    >
      {toast.msg}
    </div>
  );
}

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
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: color,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `${Math.round(size * 0.46)}px`,
        fontWeight: 700,
        color: 'var(--avatar-text)',
        flexShrink: 0,
      }}
    >
      {glyph}
    </div>
  );
}

/** Visual metadata for the assets we know about. */
// Monochrome palette: token circles are neutral; the glyph carries the identity.
const AV = 'var(--avatar-bg)';
const AV_BRAND = 'var(--avatar-brand)';

export const ASSET_META: Record<string, { name: string; glyph: string; color: string }> = {
  XLM: { name: 'Stellar Lumens', glyph: '✦', color: AV_BRAND },
  USDC: { name: 'USD Coin', glyph: '$', color: AV },
  USDT: { name: 'Tether', glyph: '₮', color: AV },
  yXLM: { name: 'yieldXLM', glyph: 'y', color: AV },
  AQUA: { name: 'Aquarius', glyph: 'A', color: AV },
  BTC: { name: 'Bitcoin', glyph: '₿', color: AV },
  ETH: { name: 'Ethereum', glyph: 'Ξ', color: AV },
  SOL: { name: 'Solana', glyph: '◎', color: AV },
};

export function assetMeta(code: string) {
  return ASSET_META[code] || { name: code, glyph: code.slice(0, 1), color: AV };
}
