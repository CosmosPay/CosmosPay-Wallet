/**
 * Responsive / device-adaptation smoke test.
 *
 *   Terminal 1:  npm run build && npm run serve:dist
 *   Terminal 2:  npm run test:responsive
 *
 * The app is a phone-shaped column. To adapt to the device without locking to a
 * single 440px width, `--frame-max` (media queries in src/pages/index.astro) widens
 * the centered column on bigger viewports. We deliberately avoid CSS `zoom`/transform
 * scaling of the whole UI — Chrome 149 crashes its GPU compositor on a zoomed subtree.
 * This guards that across phone → tablet → desktop:
 *   - nothing overflows horizontally OR vertically,
 *   - the column is full-width on phones and grows into a wider (capped) column on
 *     tablets/desktop, so it is no longer a fixed 440px.
 * Set SHOTS=<dir> to also dump a screenshot per size.
 */
import { chromium } from 'playwright';

const URL = process.env.E2E_URL || 'http://127.0.0.1:4321';
const SHOTS = process.env.SHOTS || '';

const SIZES = [
  { name: 'small-phone', w: 320, h: 568, wide: false },
  { name: 'phone', w: 390, h: 844, wide: false },
  { name: 'large-phone', w: 430, h: 932, wide: false },
  { name: 'tablet-portrait', w: 820, h: 1180, wide: true },
  { name: 'tablet-landscape', w: 1180, h: 820, wide: true },
  { name: 'desktop', w: 1440, h: 900, wide: true },
  { name: 'wide', w: 1920, h: 1080, wide: true },
] as const;

const fails: string[] = [];
const ok = (c: unknown, m: string) => (c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m)));

const browser = await chromium.launch();
try {
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, locale: 'es-ES' });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.getByText('Crear una wallet nueva').waitFor({ timeout: 20000 });
    await page.waitForTimeout(2400); // let the intro splash finish

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      // The phone column: `.shell-frame` caps its width at `--frame-max` (set by the
      // media queries in index.astro; the value lives in shell.css, not an inline style).
      const frame = document.querySelector('.shell-frame') as HTMLElement | null;
      const r = frame?.getBoundingClientRect();
      return {
        frameMax: getComputedStyle(de).getPropertyValue('--frame-max').trim(),
        frameW: r ? Math.round(r.width) : -1,
        overflowX: de.scrollWidth - window.innerWidth,
        overflowY: de.scrollHeight - window.innerHeight,
      };
    });

    ok(m.overflowX <= 1, `${s.name}: no horizontal overflow (${m.overflowX}px)`);
    ok(m.overflowY <= 1, `${s.name}: no vertical overflow (${m.overflowY}px)`);
    if (s.wide) ok(m.frameW > 460, `${s.name}: column widened past phone size (${m.frameW}px)`);
    else ok(m.frameW <= 440, `${s.name}: column fits the phone width (${m.frameW}px)`);
    ok(m.frameW <= 640, `${s.name}: column stays capped (${m.frameW}px)`);

    if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-${s.name}.png` });
    await ctx.close();
  }
} catch (e) {
  fails.push('exception: ' + (e as Error).message);
  console.log('✗ exception:', (e as Error).message);
} finally {
  await browser.close();
  console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
}
