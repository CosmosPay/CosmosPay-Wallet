/**
 * De dos elecciones a los 32 tokens.
 *
 * Dejar que el usuario toque los 32 a mano suena a libertad y termina en una
 * wallet ilegible: alcanza con errarle a uno para romper el contraste de toda
 * una pantalla. Aca elige fondo y acento, y el resto se deriva manteniendo las
 * mismas relaciones que tienen los skins que ya venian (ver tokens.ts), que
 * estan hechos a mano y funcionan.
 */
import { bestForeground, contrast, ensureContrast, hexToHsl, hslToHex, mix, withAlpha } from './color.ts';
import type { Skin, SkinMode } from './tokens.ts';

export type SkinSeed = {
  /** Color de fondo de la app. */
  bg: string;
  /** Color de los botones principales y los acentos. */
  accent: string;
  /**
   * Claro u oscuro. Si no viene se deduce del fondo, que es lo que uno espera:
   * elegir un fondo oscuro deberia dar un skin oscuro sin tener que decirlo.
   */
  mode?: SkinMode;
};

/** Cuanto contraste exigimos. 4.5 es el AA de WCAG para texto normal. */
const MIN_TEXTO = 4.5;
/** Para texto secundario, que es mas chico pero menos importante. */
const MIN_SECUNDARIO = 3;

export function deriveSkin(seed: SkinSeed): Skin {
  const bg = seed.bg;
  // Oscuro o claro lo decide cual de los dos extremos se LEE mejor sobre el
  // fondo, no un umbral de luminancia: contra un gris medio el umbral elige el
  // peor de los dos. Si el usuario lo dijo explicitamente, manda lo que dijo.
  const extremo = bestForeground(bg);
  const oscuro = seed.mode ? seed.mode === 'dark' : extremo === '#ffffff';

  // El extremo hacia el que empuja todo lo que tiene que resaltar.
  const frente = oscuro ? '#ffffff' : '#0e1311';
  const fondoProfundo = oscuro ? '#000000' : '#ffffff';

  // La rampa de textos: del mas fuerte al mas apagado. Cada escalon se mezcla
  // un poco mas hacia el fondo, y los dos primeros pasan por la guardia.
  const text = ensureContrast(frente, bg, MIN_TEXTO);
  const textSoft = ensureContrast(mix(frente, bg, 0.18), bg, MIN_TEXTO);
  const muted = ensureContrast(mix(frente, bg, 0.42), bg, MIN_SECUNDARIO);
  const dim = mix(frente, bg, 0.62);
  const dimmer = mix(frente, bg, 0.72);

  // El acento tiene que leerse sobre el fondo, y lo que va encima del acento
  // tiene que leerse sobre el acento. Las dos cosas, no una.
  const accent = ensureContrast(seed.accent, bg, MIN_SECUNDARIO);
  const onAccent = contrast('#ffffff', accent) >= contrast('#0a0c0b', accent) ? '#ffffff' : '#0a0c0b';

  // Los vidrios son el mismo frente con muy poca opacidad. Las opacidades
  // salen de los skins hechos a mano: en claro hay que cargar mas la mano
  // porque un blanco al 6% sobre un fondo claro no se ve.
  const vidrio = oscuro ? frente : '#ffffff';
  const a = (claro: number, osc: number) => (oscuro ? osc : claro);

  const hslAccent = hexToHsl(accent);
  // El resplandor de fondo toma el tono del acento, asi el skin se siente de
  // una pieza en vez de un fondo de un color con manchas de otro.
  const halo = hslAccent ? hslToHex({ h: hslAccent.h, s: Math.min(0.55, hslAccent.s + 0.1), l: oscuro ? 0.62 : 0.58 }) : accent;

  return {
    bg,
    text,
    'text-soft': textSoft,
    muted,
    dim,
    dimmer,
    accent,
    'on-accent': onAccent,

    'glass-bg': withAlpha(vidrio, a(0.58, 0.06)),
    'glass-border': withAlpha(vidrio, a(0.85, 0.12)),
    'glass-soft-bg': withAlpha(vidrio, a(0.62, 0.07)),
    'glass-soft-border': oscuro ? withAlpha(vidrio, 0.09) : withAlpha('#000000', 0.05),

    // El boton principal es el acento en oscuro, y casi tinta en claro: asi se
    // comportaban los dos skins originales y es lo que hace que resalte.
    'primary-bg': oscuro ? withAlpha(accent, 0.92) : mix(frente, '#000000', 0.1),
    'primary-border': oscuro ? withAlpha(accent, 0.65) : withAlpha('#000000', 0.2),
    'primary-text': oscuro ? onAccent : '#ffffff',

    surface: withAlpha(vidrio, a(0.5, 0.05)),
    'surface-2': withAlpha(vidrio, a(0.4, 0.045)),
    hairline: oscuro ? withAlpha(vidrio, 0.08) : withAlpha('#000000', 0.08),
    'nav-bg': withAlpha(oscuro ? mix(bg, fondoProfundo, 0.35) : bg, oscuro ? 0.55 : 0.62),

    blob: withAlpha(halo, a(0.3, 0.12)),
    glow: withAlpha(halo, a(0.22, 0.16)),

    'avatar-bg': oscuro ? withAlpha(vidrio, 0.09) : withAlpha('#000000', 0.06),
    'avatar-brand': oscuro ? withAlpha(accent, 0.16) : withAlpha('#000000', 0.1),
    'avatar-text': text,

    // Subir y bajar: en los skins originales no son verde y rojo, son el texto
    // y un gris. Se respeta esa decision de diseno en vez de meter semaforo.
    up: text,
    down: dim,

    'gb-bg-a': withAlpha(vidrio, a(0.42, 0.05)),
    'gb-bg-b': withAlpha(vidrio, a(0.62, 0.085)),
    'gb-bd-a': withAlpha(vidrio, a(0.5, 0.08)),
    'gb-bd-b': withAlpha(vidrio, a(0.95, 0.2)),
  };
}

/** Lo que hay que mostrarle al usuario si su eleccion hubo que corregirla. */
export type ContrastReport = {
  ok: boolean;
  /** Contraste del texto principal contra el fondo. */
  texto: number;
  /** Contraste del acento contra el fondo. */
  acento: number;
  /** True si tuvimos que apartarnos del color que pidio. */
  ajustado: boolean;
};

export function checkSeed(seed: SkinSeed): ContrastReport {
  const skin = deriveSkin(seed);
  const texto = contrast(skin.text, skin.bg);
  const acento = contrast(skin.accent, skin.bg);
  return {
    ok: texto >= MIN_TEXTO && acento >= MIN_SECUNDARIO,
    texto: Math.round(texto * 100) / 100,
    acento: Math.round(acento * 100) / 100,
    ajustado: skin.accent.toLowerCase() !== seed.accent.toLowerCase(),
  };
}
