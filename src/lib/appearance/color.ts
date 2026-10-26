/**
 * Lo minimo de color para derivar un skin entero a partir de dos elecciones.
 *
 * No hay libreria de color en el proyecto y no vale la pena sumar una: con
 * convertir entre hex y HSL, mezclar y medir contraste alcanza. Lo importante
 * es el contraste: si el usuario elige un fondo y un acento que no se leen
 * entre si, la wallet queda inusable y la culpa es nuestra, no suya.
 */

export type Rgb = { r: number; g: number; b: number };
export type Hsl = { h: number; s: number; l: number };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Acepta #abc, #aabbcc y #aabbccdd (el alfa se ignora). */
export function hexToRgb(hex: string): Rgb | null {
  const s = hex.trim().replace(/^#/, '');
  const full =
    s.length === 3 || s.length === 4
      ? s
          .slice(0, 3)
          .split('')
          .map((c) => c + c)
          .join('')
      : s.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = clamp(s, 0, 1);
  const ln = clamp(l, 0, 1);
  if (sn === 0) {
    const v = ln * 255;
    return { r: v, g: v, b: v };
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const canal = (t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return { r: canal(hn + 1 / 3) * 255, g: canal(hn) * 255, b: canal(hn - 1 / 3) * 255 };
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsl(rgb) : null;
}

export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl));
}

/** Mezcla dos colores. t=0 devuelve a, t=1 devuelve b. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  const k = clamp(t, 0, 1);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * k,
    g: ca.g + (cb.g - ca.g) * k,
    b: ca.b + (cb.b - ca.b) * k,
  });
}

/** El mismo color con alfa, para los vidrios y las hairlines. */
export function withAlpha(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const a = Math.round(clamp(alpha, 0, 1) * 1000) / 1000;
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
}

/** Luminancia relativa segun WCAG 2.1. */
export function luminance(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const canal = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(c.r) + 0.7152 * canal(c.g) + 0.0722 * canal(c.b);
}

/** Razon de contraste entre dos colores: de 1 (iguales) a 21 (negro contra blanco). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const claro = Math.max(la, lb);
  const oscuro = Math.min(la, lb);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** True si el fondo es oscuro, o sea que encima va texto claro. */
export function isDark(hex: string): boolean {
  return luminance(hex) < 0.22;
}

/**
 * Cual de los dos extremos se lee mejor sobre este fondo.
 *
 * No alcanza con mirar si el fondo es oscuro: contra un gris medio como #808080
 * el blanco da 3.95 y el negro 5.32, asi que un umbral de luminancia elige el
 * peor de los dos justo en la franja donde mas importa acertar. Se mide.
 */
export function bestForeground(fondo: string): string {
  return contrast('#ffffff', fondo) >= contrast('#000000', fondo) ? '#ffffff' : '#000000';
}

/**
 * Acerca `color` al blanco o al negro hasta que se lea sobre `fondo`.
 *
 * Es la red que evita que alguien elija gris sobre gris y se quede con una
 * wallet ilegible. Devuelve lo mas parecido posible al color pedido que
 * todavia cumple el contraste.
 */
export function ensureContrast(color: string, fondo: string, minimo = 4.5): string {
  if (contrast(color, fondo) >= minimo) return color;
  const destino = bestForeground(fondo);
  let mejor = color;
  for (let paso = 1; paso <= 20; paso++) {
    const intento = mix(color, destino, paso / 20);
    mejor = intento;
    if (contrast(intento, fondo) >= minimo) return intento;
  }
  // Ni el blanco ni el negro puros alcanzan: devolvemos el extremo, que es lo
  // mas legible que existe contra ese fondo.
  return mejor;
}
