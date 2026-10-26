/**
 * Prueba de la apariencia en un navegador de verdad.
 *
 *   Terminal 1:  npm run build && PORT=4330 npm run serve:dist
 *   Terminal 2:  E2E_URL=http://127.0.0.1:4330 npm run test:appearance
 *
 * Lo que comprueba, que es lo que no ve ningun typecheck: que elegir un skin
 * cambie de verdad los tokens sobre <html>, que la eleccion sobreviva a un
 * reload sin parpadeo, y que quien ya tenia la clave vieja 'cosmos.theme' no
 * pierda su tema al actualizar.
 */
import { chromium } from 'playwright';

const URL = process.env.E2E_URL || 'http://127.0.0.1:4330';
const MNEMONIC = 'illness spike retreat truth genius clock brain pass fit cave bargain toe';
const PASS = 'test-pass-123';

const fails: string[] = [];
const ok = (c: unknown, m: string) =>
  c ? console.log('  ok   ' + m) : (fails.push(m), console.log('  FALLA ' + m));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 440, height: 880 }, locale: 'es-ES' });
const page = await ctx.newPage();
const pageErrors: string[] = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

/** Los tokens tal como los ve el navegador en este momento. */
const leerTokens = () =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      bg: cs.getPropertyValue('--bg').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
      text: cs.getPropertyValue('--text').trim(),
      dataTheme: document.documentElement.getAttribute('data-theme'),
      meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '',
      guardado: localStorage.getItem('cosmos.appearance'),
    };
  });

try {
  console.log('entrando a la wallet');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.getByText('Ya tengo una wallet').waitFor({ timeout: 20000 });
  await page.getByText('Ya tengo una wallet').click();
  await page.locator('textarea').fill(MNEMONIC);
  await page.getByRole('button', { name: 'Importar wallet' }).click();
  await page.getByPlaceholder('p. ej. Alex').fill('Test User');
  await page.getByPlaceholder('tu@correo.com').fill('test@cosmos.com');
  await page.locator('input[type="date"]').fill('1990-05-15');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByPlaceholder('Mínimo 8 caracteres').fill(PASS);
  await page.getByPlaceholder('Repite la contraseña').fill(PASS);
  await page.getByRole('button', { name: 'Crear wallet' }).click();
  await page.getByRole('button', { name: 'Ver mi wallet' }).click({ timeout: 30000 });
  ok(true, 'wallet importada');

  const inicial = await leerTokens();
  ok(inicial.dataTheme === 'dark', 'arranca en oscuro');

  console.log('\nel selector de skins');
  // El avatar del header lleva al perfil, y de ahi se entra a Ajustes.
  await page.locator('div.tap').last().click();
  await page.getByText('Ajustes y red').waitFor({ timeout: 10000 });
  await page.getByText('Ajustes y red').click();
  await page.getByText('Apariencia').waitFor({ timeout: 10000 });
  ok(true, 'la seccion de apariencia abre');

  const muestras = await page.locator('button:has(> div[style*="border-radius: 12px"])').count();
  ok(muestras >= 8, `hay ${muestras} skins para elegir, esperaba 8 o mas`);

  console.log('\nelegir un skin cambia los tokens');
  await page.getByText('Medianoche', { exact: true }).click();
  await page.waitForTimeout(400);
  const medianoche = await leerTokens();
  ok(medianoche.bg !== inicial.bg, `el fondo cambio (${inicial.bg} -> ${medianoche.bg})`);
  ok(medianoche.meta === medianoche.bg, 'la barra del navegador sigue al fondo');
  ok((medianoche.guardado ?? '').includes('medianoche'), 'quedo guardado');

  console.log('\nsobrevive al reload');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const trasReload = await leerTokens();
  ok(trasReload.bg === medianoche.bg, `el fondo se mantuvo (${trasReload.bg})`);

  console.log('\nun skin claro invierte el modo');
  await page.evaluate(() => {
    localStorage.setItem('cosmos.appearance', JSON.stringify({ preset: 'papel' }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const papel = await leerTokens();
  ok(papel.dataTheme === 'light', 'data-theme paso a light');

  console.log('\nquien tenia la clave vieja no pierde su tema');
  await page.evaluate(() => {
    localStorage.removeItem('cosmos.appearance');
    localStorage.setItem('cosmos.theme', 'light');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const migrado = await leerTokens();
  ok(migrado.dataTheme === 'light', 'respeta cosmos.theme=light de antes');

  console.log('\ncolores propios');
  await page.evaluate(() => {
    localStorage.setItem(
      'cosmos.appearance',
      JSON.stringify({ preset: 'custom', custom: { bg: '#2b1055', accent: '#ffd36e' } }),
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  const propio = await leerTokens();
  ok(propio.bg.replace(/\s/g, '').toLowerCase().includes('43, 16, 85'.replace(/\s/g, '')) || propio.bg === '#2b1055',
     `el fondo propio se aplico (${propio.bg})`);

  ok(pageErrors.length === 0, `sin errores de pagina (${pageErrors.slice(0, 2).join(' | ')})`);
} finally {
  await browser.close();
}

console.log('');
if (fails.length) {
  console.error(`${fails.length} comprobaciones fallaron`);
  process.exit(1);
}
console.log('todo ok');
