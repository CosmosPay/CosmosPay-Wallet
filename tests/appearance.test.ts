/**
 * Pruebas del derivador de skins.
 *
 *   node --experimental-strip-types tests/appearance.test.ts
 *
 * Lo que de verdad importa aca es el contraste: el usuario puede elegir
 * cualquier par de colores, incluido gris sobre gris, y la wallet tiene que
 * quedar legible igual. Si estas pruebas pasan, nadie puede dejarse la app
 * inusable eligiendo mal.
 */
import { contrast, hexToRgb, hslToHex, hexToHsl, mix, withAlpha } from '../src/lib/appearance/color.ts';
import { deriveSkin, checkSeed } from '../src/lib/appearance/derive.ts';
import { PRESETS } from '../src/lib/appearance/presets.ts';
import { TOKEN_NAMES } from '../src/lib/appearance/tokens.ts';

let fallos = 0;
let corridas = 0;

function ok(cond: boolean, msg: string) {
  corridas++;
  if (!cond) {
    fallos++;
    console.error('  FALLO: ' + msg);
  }
}

function casi(a: number, b: number, tol: number, msg: string) {
  ok(Math.abs(a - b) <= tol, `${msg} (esperaba ~${b}, fue ${a})`);
}

console.log('color');
{
  ok(hexToRgb('#fff')?.r === 255, 'hex corto se expande');
  ok(hexToRgb('#ff0000')?.r === 255, 'hex largo');
  ok(hexToRgb('no es color') === null, 'basura devuelve null');
  casi(contrast('#000000', '#ffffff'), 21, 0.1, 'negro contra blanco es 21');
  casi(contrast('#ffffff', '#ffffff'), 1, 0.01, 'un color contra si mismo es 1');
  ok(mix('#000000', '#ffffff', 0.5).toLowerCase() === '#808080', 'mezcla al medio da gris');
  ok(withAlpha('#ff0000', 0.5) === 'rgba(255, 0, 0, 0.5)', 'alfa');
  // Ida y vuelta por HSL sin perder el color.
  const ida = hslToHex(hexToHsl('#3a7bd5')!);
  ok(ida.toLowerCase() === '#3a7bd5', `hex -> hsl -> hex conserva el color (fue ${ida})`);
}

console.log('los presets que vienen de fabrica');
for (const p of PRESETS) {
  // Ninguno puede tener un token faltante: un hueco se ve como un color
  // heredado del skin anterior al cambiar, que es peor que un error.
  for (const t of TOKEN_NAMES) {
    ok(typeof p.skin[t] === 'string' && p.skin[t].length > 0, `${p.id}: falta el token ${t}`);
  }
  const c = contrast(p.skin.text, p.skin.bg);
  ok(c >= 4.5, `${p.id}: el texto contra el fondo da ${c.toFixed(2)}, necesita 4.5`);
  const ca = contrast(p.skin.accent, p.skin.bg);
  ok(ca >= 3, `${p.id}: el acento contra el fondo da ${ca.toFixed(2)}, necesita 3`);
  // Lo que va encima del boton principal tiene que leerse sobre el boton.
  const cp = contrast(p.skin['primary-text'], p.skin['primary-bg'].replace(/rgba?\([^)]*\)/, p.skin.accent));
  ok(cp >= 3, `${p.id}: el texto del boton principal da ${cp.toFixed(2)}`);
}

console.log('colores hostiles elegidos por el usuario');
{
  const hostiles: Array<[string, string, string]> = [
    ['#808080', '#808080', 'gris sobre el mismo gris'],
    ['#ffffff', '#fffffe', 'blanco sobre casi blanco'],
    ['#000000', '#010101', 'negro sobre casi negro'],
    ['#ffff00', '#ffffff', 'amarillo sobre blanco'],
    ['#123456', '#123457', 'dos azules identicos'],
    ['#ff0000', '#00ff00', 'rojo y verde'],
  ];
  for (const [bg, accent, nombre] of hostiles) {
    const skin = deriveSkin({ bg, accent });
    const c = contrast(skin.text, skin.bg);
    ok(c >= 4.5, `${nombre}: el texto quedo en ${c.toFixed(2)}, deberia ser al menos 4.5`);
    for (const t of TOKEN_NAMES) {
      ok(typeof skin[t] === 'string' && skin[t].length > 0, `${nombre}: falta el token ${t}`);
    }
  }
}

console.log('el fondo decide claro u oscuro');
{
  ok(deriveSkin({ bg: '#000000', accent: '#ffffff' }).text.toLowerCase() !== '#000000', 'fondo negro da texto claro');
  const claro = deriveSkin({ bg: '#ffffff', accent: '#000000' });
  ok(contrast(claro.text, claro.bg) >= 4.5, 'fondo blanco da texto legible');
}

console.log('el reporte avisa cuando hubo que corregir');
{
  const malo = checkSeed({ bg: '#808080', accent: '#878787' });
  ok(malo.ajustado, 'avisa que el acento se corrigio');
  const bueno = checkSeed({ bg: '#080808', accent: '#ffffff' });
  ok(!bueno.ajustado && bueno.ok, 'un par que ya anda no se toca');
}

console.log('');
if (fallos === 0) {
  console.log(`OK: ${corridas} comprobaciones`);
} else {
  console.error(`${fallos} de ${corridas} comprobaciones fallaron`);
  process.exit(1);
}
