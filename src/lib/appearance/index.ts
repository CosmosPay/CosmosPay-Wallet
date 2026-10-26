/**
 * La apariencia de la wallet: que skin, con que colores, y mas adelante la
 * portada y el orden de los bloques.
 *
 * Donde se guarda y por que:
 *
 * localStorage es la fuente con la que se pinta, porque es SINCRONA. El codigo
 * que ya existia aplicaba el tema en el momento de cargar el modulo, antes del
 * primer pintado, justamente para que no se vea un parpadeo del tema
 * equivocado. Pasar esto a @capacitor/preferences, que es asincrono, traeria
 * ese parpadeo de vuelta en el celular.
 *
 * Preferences se usa igual, pero como copia durable: localStorage dentro de un
 * WebView nativo se puede limpiar, y ahi la preferencia se perderia. Entonces
 * se escribe en los dos lados y, si al arrancar localStorage esta vacio, se
 * rehidrata desde Preferences y se vuelve a aplicar.
 *
 * Las tres superficies (web, extension y app) comparten este archivo, porque
 * las tres salen del mismo build.
 */
import { storageGet, storageSet } from '../storage.ts';
import { isDark } from './color.ts';
import { deriveSkin, type SkinSeed } from './derive.ts';
import { DEFAULT_PRESET, presetById, type PresetId } from './presets.ts';
import { DARK, TOKEN_NAMES, type Skin, type SkinMode } from './tokens.ts';

export * from './tokens.ts';
export * from './color.ts';
export * from './derive.ts';
export * from './presets.ts';

const KEY = 'cosmos.appearance';
/** La clave vieja, de cuando esto era solo claro y oscuro. */
const KEY_VIEJA = 'cosmos.theme';

export type Appearance = {
  /** Un preset de fabrica, o 'custom' si eligio sus propios colores. */
  preset: PresetId | 'custom';
  /** Los dos colores elegidos. Solo cuando preset es 'custom'. */
  custom?: SkinSeed;
};

export const DEFAULT_APPEARANCE: Appearance = { preset: DEFAULT_PRESET };

/** El skin que corresponde a una configuracion. */
export function skinOf(a: Appearance): Skin {
  if (a.preset === 'custom' && a.custom) return deriveSkin(a.custom);
  return presetById(a.preset)?.skin ?? DARK;
}

export function modeOf(a: Appearance): SkinMode {
  if (a.preset === 'custom' && a.custom) {
    // Si no lo dijo explicitamente, lo decide el fondo que eligio.
    return a.custom.mode ?? (isDark(a.custom.bg) ? 'dark' : 'light');
  }
  return presetById(a.preset)?.mode ?? 'dark';
}

function parse(raw: string | null): Appearance | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Appearance;
    if (!o || typeof o !== 'object' || !o.preset) return null;
    if (o.preset !== 'custom' && !presetById(o.preset)) return null;
    if (o.preset === 'custom' && (!o.custom || !o.custom.bg || !o.custom.accent)) return null;
    return o;
  } catch {
    return null;
  }
}

/** Lee lo guardado, de forma sincrona, para poder pintar sin parpadeo. */
export function readAppearance(): Appearance {
  try {
    const guardado = parse(localStorage.getItem(KEY));
    if (guardado) return guardado;
    // Quien ya venia usando la wallet tiene la clave vieja: se respeta su
    // eleccion en vez de devolverlo al default.
    const viejo = localStorage.getItem(KEY_VIEJA);
    if (viejo === 'light' || viejo === 'dark') return { preset: viejo };
  } catch {
    /* sin localStorage, por ejemplo durante el build de Astro */
  }
  return DEFAULT_APPEARANCE;
}

/** Escribe en los dos lados: el sincrono para pintar, el durable para que sobreviva. */
export function writeAppearance(a: Appearance): void {
  const raw = JSON.stringify(a);
  try {
    localStorage.setItem(KEY, raw);
    // Se mantiene la clave vieja al dia para no romper nada que todavia la lea.
    localStorage.setItem(KEY_VIEJA, modeOf(a));
  } catch {
    /* ignorar */
  }
  void storageSet(KEY, raw).catch(() => {});
}

/** Pinta un skin poniendo los 32 tokens sobre <html>. */
export function applySkin(skin: Skin, mode: SkinMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const name of TOKEN_NAMES) {
    root.style.setProperty(`--${name}`, skin[name]);
  }
  // index.astro tiene reglas colgadas de [data-theme='light'], como invertir el
  // logo. Si no se mantiene este atributo, esas reglas dejan de aplicar.
  root.setAttribute('data-theme', mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', skin.bg);
}

export function applyAppearance(a: Appearance): void {
  applySkin(skinOf(a), modeOf(a));
}

/**
 * Se llama al cargar el modulo, antes del primer pintado.
 *
 * Si localStorage estaba vacio pero hay algo en Preferences (WebView limpiado,
 * o una instalacion que migro), se rehidrata despues y se vuelve a aplicar. Ese
 * camino si parpadea, pero es el raro: lo normal es que localStorage tenga el
 * valor y se pinte bien de entrada.
 */
export function bootAppearance(): Appearance {
  const a = readAppearance();
  applyAppearance(a);

  let teniaLocal = false;
  try {
    teniaLocal = localStorage.getItem(KEY) != null || localStorage.getItem(KEY_VIEJA) != null;
  } catch {
    /* ignorar */
  }
  if (!teniaLocal) {
    void storageGet(KEY)
      .then((raw) => {
        const durable = parse(raw);
        if (durable) {
          applyAppearance(durable);
          try {
            localStorage.setItem(KEY, JSON.stringify(durable));
          } catch {
            /* ignorar */
          }
        }
      })
      .catch(() => {});
  }
  return a;
}
