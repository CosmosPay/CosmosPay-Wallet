/** Shared UI primitives — faithful to the Cosmos design system. */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import type { WalletStore } from '@/components/store';
import { ASSET_ICONS, STELLAR_MARK } from '@/components/assetIcons';

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

// Unified control metrics. Every full-width <input> and <button> shares the same
// height + pill radius so the form controls line up — mismatched sizes break the UI.
export const CONTROL_H = 54;
export const CONTROL: CSSProperties = {
  height: `${CONTROL_H}px`,
  boxSizing: 'border-box',
  borderRadius: '999px',
  padding: '0 20px',
};
/** Spread onto full-width single-line inputs for a pill that matches the buttons. */
export const inputStyle: CSSProperties = {
  ...CONTROL,
  width: '100%',
  color: 'var(--text)',
  fontSize: '15px',
  fontWeight: 600,
  outline: 'none',
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
          height: '100vh',
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
        {store && <Toast toast={store.toast} />}
        {store && <ConfirmSign store={store} />}
      </div>
    </div>
  );
}

/** Password gate shown before any signing action (toggleable in Settings). */
export function ConfirmSign({ store }: { store: WalletStore }) {
  const t = store.t;
  const req = store.confirmReq;
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setPwd('');
    setErr('');
    setBusy(false);
  }, [req]);

  if (!req) return null;

  const submit = async () => {
    if (!pwd || busy) return;
    setBusy(true);
    setErr('');
    const okPwd = await store.checkPassword(pwd);
    setBusy(false);
    if (okPwd) {
      store.resolveConfirm(true);
    } else {
      setErr(t('confirmSig.wrongPwd'));
      setPwd('');
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'rgba(0,0,0,.55)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        animation: 'fadeUp .2s ease',
      }}
    >
      <div style={{ width: '100%', maxWidth: '340px', ...C.glass, borderRadius: '22px', padding: '22px', animation: 'pop .26s ease' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
          <div style={{ width: '52px', height: '52px', borderRadius: '50%', ...C.glassSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>✎</div>
        </div>
        <div style={{ fontSize: '18px', fontWeight: 800, textAlign: 'center', marginBottom: '6px' }}>{req.title}</div>
        {req.message && <div style={{ fontSize: '13px', color: C.muted, fontWeight: 600, textAlign: 'center', lineHeight: 1.5, marginBottom: '16px' }}>{req.message}</div>}
        <input
          type="password"
          value={pwd}
          autoFocus
          placeholder={t('pwd.label')}
          onChange={(e) => setPwd((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={{ ...C.glass, ...inputStyle, textAlign: 'center', marginBottom: err ? '8px' : '16px' }}
        />
        {err && <div style={{ fontSize: '12.5px', fontWeight: 700, color: C.danger, textAlign: 'center', marginBottom: '12px' }}>{err}</div>}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => store.resolveConfirm(false)} style={{ flex: 1, height: '52px', ...C.glassSoft, color: 'var(--text)', border: 'none', borderRadius: '999px', fontSize: '15px', fontWeight: 800, cursor: 'pointer' }}>
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!pwd || busy}
            style={{ flex: 1, height: '52px', ...C.glassBright, color: 'var(--primary-text)', borderRadius: '999px', fontSize: '15px', fontWeight: 800, cursor: !pwd || busy ? 'default' : 'pointer', opacity: !pwd || busy ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {busy ? <Spinner /> : t('confirmSig.sign')}
          </button>
        </div>
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

type NavTab = 'home' | 'earn' | 'markets' | 'profile';

export function BottomNav({ store }: { store: WalletStore }) {
  const t = store.t;
  // Home sits in the centre so the active indicator rests in the middle by default.
  const tabs: { key: string; label: string; icon: ReactNode }[] = [
    {
      key: 'earn',
      label: t('tab.earn'),
      icon: (
        <>
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.9" />
          <path d="M9 14.5l6-6M9.5 9.5h.01M14.5 14.5h.01" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </>
      ),
    },
    {
      key: 'markets',
      label: t('tab.markets'),
      icon: <path d="M4 16l4-5 4 3 4-7 4 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />,
    },
    {
      key: 'home',
      label: t('tab.home'),
      icon: <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />,
    },
    {
      key: 'swap',
      label: t('home.swap'),
      icon: <path d="M7 7h11l-3-3M17 17H6l3 3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />,
    },
    {
      key: 'profile',
      label: t('tab.profile'),
      icon: (
        <>
          <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.9" />
          <path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </>
      ),
    },
  ];
  const activeKey = store.screen === 'swap' ? 'swap' : store.tab;
  const idx = Math.max(0, tabs.findIndex((x) => x.key === activeKey));
  const go = (key: string) =>
    key === 'swap' ? store.setScreen('swap') : store.go(key as NavTab, key as NavTab);
  const spring = 'cubic-bezier(.34,1.3,.5,1)';

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '92px',
        zIndex: 5,
        padding: '0 16px calc(20px + env(safe-area-inset-bottom))',
        display: 'flex',
        alignItems: 'center',
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(24px) saturate(150%)',
        WebkitBackdropFilter: 'blur(24px) saturate(150%)',
        borderTop: '1px solid var(--hairline)',
      }}
    >
      {/* sliding active indicator — follows the selected tab */}
      <div
        style={{
          position: 'absolute',
          left: '16px',
          top: 0,
          bottom: 'calc(20px + env(safe-area-inset-bottom))',
          width: `calc((100% - 32px) / ${tabs.length})`,
          transform: `translateX(${idx * 100}%)`,
          transition: `transform .42s ${spring}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
        <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: C.accent, boxShadow: '0 10px 22px rgba(0,0,0,.30)', transform: 'translateY(-10px)' }} />
      </div>

      {tabs.map((tb) => {
        const on = tb.key === activeKey;
        return (
          <div
            key={tb.key}
            onClick={() => go(tb.key)}
            className="tap"
            style={{
              flex: 1,
              position: 'relative',
              zIndex: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              cursor: 'pointer',
              color: on ? 'var(--on-accent)' : 'var(--dim)',
              transform: on ? 'translateY(-10px)' : 'none',
              transition: `transform .42s ${spring}, color .25s ease`,
            }}
          >
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none">{tb.icon}</svg>
            {!on && <span style={{ fontSize: '10px', fontWeight: 700 }}>{tb.label}</span>}
          </div>
        );
      })}
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
        ...CONTROL,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--primary-text)',
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
        ...CONTROL,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text)',
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
            borderRadius: '999px',
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
  // Keep the last toast mounted while it animates out, so it doesn't vanish
  // abruptly when `toast` flips to null. `leaving` swaps the entrance pop for
  // an exit popOut; once that finishes we unmount (or a new toast interrupts it).
  const [shown, setShown] = useState(toast);
  const [leaving, setLeaving] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    if (toast) {
      setShown(toast);
      setLeaving(false);
    } else if (shown) {
      setLeaving(true);
      exitTimer.current = setTimeout(() => {
        setShown(null);
        setLeaving(false);
      }, 230); // must match the popOut duration below
    }
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  if (!shown) return null;
  const bg =
    shown.kind === 'ok'
      ? 'var(--accent)'
      : shown.kind === 'err'
      ? 'rgba(210,64,64,.92)'
      : 'var(--glass-bg)';
  const fg = shown.kind === 'ok' ? 'var(--on-accent)' : shown.kind === 'err' ? '#fff' : 'var(--text)';
  return (
    // Flex-centered overlay so the card is centered from the first frame; only the
    // inner card scales in (animating transform on the card itself would fight the
    // centering and make it appear off to one side before snapping to the middle).
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        pointerEvents: 'none',
      }}
    >
      <div
        key={shown.msg}
        style={{
          maxWidth: '320px',
          width: '100%',
          background: bg,
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          border: '1px solid rgba(255,255,255,.16)',
          color: fg,
          borderRadius: '18px',
          padding: '16px 18px',
          fontSize: '14px',
          fontWeight: 700,
          textAlign: 'center',
          lineHeight: 1.45,
          boxShadow: '0 18px 50px rgba(0,0,0,.5)',
          animation: leaving ? 'popOut .23s ease forwards' : 'pop .28s ease',
        }}
      >
        {shown.msg}
      </div>
    </div>
  );
}

/**
 * CosmosPay account card — shared by the Home screen and the Swap screen so both
 * route the user through the same provisioning/linking flow. States:
 *   - enable (initial) / confirm-email (register flow);
 *   - link offer + access-code entry (when the email already has an account).
 */
export function EnableReceivingCard({ store }: { store: WalletStore }) {
  const t = store.t;
  const pending = !!store.cosmosPayPending;
  const link = store.cosmosLink;
  const [code, setCode] = useState('');

  const cardStyle: CSSProperties = { ...C.glass, borderRadius: '18px', padding: '18px', marginBottom: '22px' };
  const titleStyle: CSSProperties = { fontSize: '15px', fontWeight: 800, marginBottom: '6px' };
  const descStyle: CSSProperties = { fontSize: '13px', color: C.muted, fontWeight: 600, lineHeight: 1.5, marginBottom: '14px' };
  const primaryBtn: CSSProperties = { width: '100%', height: '54px', background: C.accent, color: 'var(--on-accent)', border: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, cursor: 'pointer' };
  const cancelBtn: CSSProperties = { width: '100%', marginTop: '10px', background: 'transparent', border: 'none', color: C.muted, fontSize: '13px', fontWeight: 700, cursor: 'pointer' };

  // Link flow — enter the emailed access code.
  if (link?.stage === 'sent') {
    const ready = code.length === 6 && !store.busy;
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>{t('cosmospay.codeTitle')}</div>
        <div style={descStyle}>{t('cosmospay.codeDesc')}</div>
        <input
          value={code}
          onChange={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={t('cosmospay.codePlaceholder')}
          style={{ width: '100%', height: '54px', boxSizing: 'border-box', borderRadius: '999px', padding: '0 20px', textAlign: 'center', letterSpacing: '.3em', fontSize: '20px', fontWeight: 800, background: C.cardSolid, color: 'var(--text)', border: '1px solid var(--glass-border)', outline: 'none', marginBottom: '12px' }}
        />
        <button onClick={() => store.submitLinkCode(code)} disabled={!ready} style={{ ...primaryBtn, opacity: ready ? 1 : 0.5 }}>
          {store.busy ? <Spinner /> : t('cosmospay.linkVerifyCta')}
        </button>
        <button onClick={() => { setCode(''); store.cancelLink(); }} disabled={store.busy} style={cancelBtn}>
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  // Link flow — offer to link the existing account.
  if (link?.stage === 'offer') {
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>{t('cosmospay.existsLinkTitle')}</div>
        <div style={descStyle}>{t('cosmospay.existsLinkDesc')}</div>
        <button onClick={() => store.linkReceiving()} disabled={store.busy} style={primaryBtn}>
          {store.busy ? <Spinner /> : t('cosmospay.linkCta')}
        </button>
        <button onClick={() => store.cancelLink()} disabled={store.busy} style={cancelBtn}>
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  // Default — enable (create) / confirm-email.
  return (
    <div style={cardStyle}>
      <div style={titleStyle}>{pending ? t('cosmospay.pendingTitle') : t('cosmospay.cardTitle')}</div>
      <div style={descStyle}>{pending ? t('cosmospay.pendingDesc') : t('cosmospay.cardDesc')}</div>
      <button
        onClick={() => (pending ? store.claimReceiving() : store.enableReceiving())}
        disabled={store.busy}
        style={primaryBtn}
      >
        {store.busy ? <Spinner /> : pending ? t('cosmospay.confirmCta') : t('cosmospay.cta')}
      </button>
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
  EURC: { name: 'Euro Coin', glyph: '€', color: AV },
  yXLM: { name: 'yieldXLM', glyph: 'y', color: AV },
  AQUA: { name: 'Aquarius', glyph: 'A', color: AV },
};

export function assetMeta(code: string) {
  return ASSET_META[code] || { name: code, glyph: code.slice(0, 1), color: AV };
}

/** Official monochrome asset logo (falls back to a glyph circle for unknown codes). */
export function AssetLogo({ code, size = 34 }: { code: string; size?: number }) {
  const icon = ASSET_ICONS[code];
  if (icon) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: 'block', flexShrink: 0, color: 'var(--text)' }}>
        <path d={icon.d} fill="currentColor" fillRule={icon.evenodd ? 'evenodd' : 'nonzero'} />
      </svg>
    );
  }
  const m = assetMeta(code);
  return <TokenAvatar glyph={m.glyph} color={m.color} size={size} />;
}

/** The Stellar wordmark/glyph (monochrome) — used by the network selector. */
export function StellarMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', flexShrink: 0, color: 'currentColor' }}>
      <path d={STELLAR_MARK} fill="currentColor" />
    </svg>
  );
}

/** Network selector as a dropdown (lists networks + "add network") — dev fast-access. */
export function NetworkDropdown({ store }: { store: WalletStore }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: '7px', ...C.glassSoft, color: 'var(--text)', borderRadius: '999px', padding: '7px 12px', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer' }}
      >
        <StellarMark size={13} />
        {store.network.label}
        <span style={{ fontSize: '9px', opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▼</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
          <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 31, minWidth: '200px', ...C.glass, borderRadius: '16px', padding: '6px', animation: 'fadeUp .18s ease' }}>
            {store.networks.map((n) => {
              const on = n.id === store.network.id;
              return (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!on) store.switchNetwork(n.id);
                    setOpen(false);
                  }}
                  className="tap"
                  style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '10px 12px', borderRadius: '11px', cursor: 'pointer', background: on ? 'var(--surface)' : 'transparent', color: 'var(--text)' }}
                >
                  <StellarMark size={14} />
                  <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 700 }}>{n.label}</span>
                  {on && <span style={{ color: C.accent, fontWeight: 800 }}>✓</span>}
                </div>
              );
            })}
            <div
              onClick={() => {
                setOpen(false);
                store.setScreen('add-network');
              }}
              className="tap"
              style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '10px 12px', borderRadius: '11px', cursor: 'pointer', color: C.accent, fontWeight: 800, fontSize: '13.5px', borderTop: '1px solid var(--hairline)', marginTop: '2px' }}
            >
              <span style={{ width: '14px', textAlign: 'center', fontSize: '16px' }}>+</span>
              {store.t('net.add')}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
