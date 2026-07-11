/** UI design tokens (JS side). The CSS twin lives in src/styles/app.css; colours
 *  resolve through the CSS variables declared in src/pages/index.astro, so the
 *  whole UI re-themes instantly when `data-theme` flips between dark and light. */
import type { CSSProperties } from 'react';

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
  // ---- glassmorphism system (JS objects for dynamic/conditional composition;
  //      static uses should prefer the .glass/.glass-soft/.glass-bright classes) ----
  glass: {
    background: 'var(--glass-bg)',
    backdropFilter: 'blur(22px) saturate(150%)',
    WebkitBackdropFilter: 'blur(22px) saturate(150%)',
    border: '1px solid var(--glass-border)',
    boxShadow: 'inset 0 1px 0 var(--glass-border), 0 10px 30px rgba(0,0,0,.28)',
    animation: 'glassBreath 8s ease-in-out infinite',
  } as CSSProperties,
  glassSoft: {
    background: 'var(--glass-soft-bg)',
    backdropFilter: 'blur(16px) saturate(140%)',
    WebkitBackdropFilter: 'blur(16px) saturate(140%)',
    border: '1px solid var(--glass-soft-border)',
    animation: 'glassBreath 11s ease-in-out infinite',
  } as CSSProperties,
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
