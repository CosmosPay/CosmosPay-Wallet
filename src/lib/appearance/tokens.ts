/**
 * Los tokens de color de la wallet, como dato en vez de como CSS suelto.
 *
 * Toda la interfaz consume `var(--algo)` a traves del objeto `C` de parts.tsx,
 * asi que un skin no es mas que un valor para cada uno de estos nombres. Tener
 * la lista tipada es lo que permite generar skins por algoritmo y validar que
 * ninguno quede incompleto.
 *
 * El CSS de index.astro sigue definiendo dark y light: es el estado inicial con
 * el que se pinta la primera vez. Lo de aca se aplica encima sobre <html>.
 */

export const TOKEN_NAMES = [
  'bg',
  'text',
  'text-soft',
  'muted',
  'dim',
  'dimmer',
  'accent',
  'on-accent',
  'glass-bg',
  'glass-border',
  'glass-soft-bg',
  'glass-soft-border',
  'primary-bg',
  'primary-border',
  'primary-text',
  'surface',
  'surface-2',
  'hairline',
  'nav-bg',
  'blob',
  'glow',
  'avatar-bg',
  'avatar-brand',
  'avatar-text',
  'up',
  'down',
  'gb-bg-a',
  'gb-bg-b',
  'gb-bd-a',
  'gb-bd-b',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/** Un skin completo: un valor CSS para cada token. */
export type Skin = Record<TokenName, string>;

/** Claro u oscuro. Decide el sentido de los degradados y el color del texto. */
export type SkinMode = 'dark' | 'light';

/**
 * Los dos skins que ya existian, copiados tal cual de index.astro. Son la
 * referencia contra la que se compara cualquier skin generado: si uno derivado
 * se ve peor que esto, la derivacion esta mal.
 */
export const DARK: Skin = {
  bg: '#080808',
  text: '#ffffff',
  'text-soft': '#cfd4d1',
  muted: '#9aa19d',
  dim: '#6a716d',
  dimmer: '#5c6460',
  accent: '#ffffff',
  'on-accent': '#0a0c0b',
  'glass-bg': 'rgba(255, 255, 255, 0.06)',
  'glass-border': 'rgba(255, 255, 255, 0.12)',
  'glass-soft-bg': 'rgba(255, 255, 255, 0.07)',
  'glass-soft-border': 'rgba(255, 255, 255, 0.09)',
  'primary-bg': 'rgba(255, 255, 255, 0.92)',
  'primary-border': 'rgba(255, 255, 255, 0.65)',
  'primary-text': '#0a0c0b',
  surface: 'rgba(255, 255, 255, 0.05)',
  'surface-2': 'rgba(255, 255, 255, 0.045)',
  hairline: 'rgba(255, 255, 255, 0.08)',
  'nav-bg': 'rgba(10, 10, 10, 0.55)',
  blob: 'rgba(255, 255, 255, 0.12)',
  glow: 'rgba(255, 255, 255, 0.16)',
  'avatar-bg': 'rgba(255, 255, 255, 0.09)',
  'avatar-brand': 'rgba(255, 255, 255, 0.16)',
  'avatar-text': '#ffffff',
  up: '#ffffff',
  down: '#7c8480',
  'gb-bg-a': 'rgba(255, 255, 255, 0.05)',
  'gb-bg-b': 'rgba(255, 255, 255, 0.085)',
  'gb-bd-a': 'rgba(255, 255, 255, 0.08)',
  'gb-bd-b': 'rgba(255, 255, 255, 0.2)',
};

export const LIGHT: Skin = {
  bg: '#eceef1',
  text: '#0e1311',
  'text-soft': '#2b322f',
  muted: '#5d6762',
  dim: '#8b938e',
  dimmer: '#aab2ad',
  accent: '#0e1311',
  'on-accent': '#ffffff',
  'glass-bg': 'rgba(255, 255, 255, 0.58)',
  'glass-border': 'rgba(255, 255, 255, 0.85)',
  'glass-soft-bg': 'rgba(255, 255, 255, 0.62)',
  'glass-soft-border': 'rgba(0, 0, 0, 0.05)',
  'primary-bg': '#14191b',
  'primary-border': 'rgba(0, 0, 0, 0.2)',
  'primary-text': '#ffffff',
  surface: 'rgba(255, 255, 255, 0.5)',
  'surface-2': 'rgba(255, 255, 255, 0.4)',
  hairline: 'rgba(0, 0, 0, 0.08)',
  'nav-bg': 'rgba(236, 238, 241, 0.62)',
  blob: 'rgba(120, 150, 185, 0.3)',
  glow: 'rgba(120, 150, 190, 0.22)',
  'avatar-bg': 'rgba(0, 0, 0, 0.06)',
  'avatar-brand': 'rgba(0, 0, 0, 0.1)',
  'avatar-text': '#0e1311',
  up: '#0e1311',
  down: '#8b938e',
  'gb-bg-a': 'rgba(255, 255, 255, 0.42)',
  'gb-bg-b': 'rgba(255, 255, 255, 0.62)',
  'gb-bd-a': 'rgba(255, 255, 255, 0.5)',
  'gb-bd-b': 'rgba(255, 255, 255, 0.95)',
};

/** El color de la barra del navegador y de la status bar del celular. */
export function browserBarColor(skin: Skin): string {
  return skin.bg;
}
