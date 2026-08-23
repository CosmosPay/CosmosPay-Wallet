/**
 * Responsive / device-adaptation smoke test.
 *
 *   Terminal 1:  npm run build && npm run serve:dist
 *   Terminal 2:  npm run test:responsive
 *
 * The app has two layouts and one breakpoint between them.
 *
 * BELOW `--desk-min` it is a phone-shaped column. To adapt to the device without locking
 * to a single 440px width, `--frame-max` widens that column on bigger viewports. We
 * deliberately avoid CSS `zoom`/transform scaling of the whole UI — Chrome 149 crashes its
 * GPU compositor on a zoomed subtree.
 *
 * AT OR ABOVE it the column becomes a WINDOW: a bounded card with a border and a radius,
 * floating on the page with `--desk-pad` around it, holding a navigation rail and the
 * screen column. See the `--desk-*` block in src/styles/theme.css.
 *
 * The breakpoint is the interesting part to guard. `--desk-min` is a custom property and a
 * media query cannot read one, so the literal `1024px` is repeated in
 * src/styles/app/shell.css and src/styles/app/desktop-nav.css. Nothing makes those three
 * agree — so this reads the token and probes one pixel either side of the value it names.
 * A token bumped without the sheets (or the reverse) fails here instead of shipping a
 * window that appears at a width nobody chose.
 *
 * WHAT THIS CANNOT SEE: the rail itself. Every size below is measured on the welcome
 * screen, which has no session, and the rail is tied to the session rather than to the
 * viewport (src/app/Shell.tsx explains why). It is asserted at the end of
 * tests/wallet.e2e.ts instead, which is already signed in by then.
 *
 * Set SHOTS=<dir> to also dump a screenshot per size.
 */
import { chromium } from 'playwright';

const URL = process.env.E2E_URL || 'http://127.0.0.1:4321';
const SHOTS = process.env.SHOTS || '';

/** Long enough for the intro splash to finish and the column to settle. */
const SETTLE_MS = 2400;

const SIZES = [
  { name: 'small-phone', w: 320, h: 568, wide: false },
  { name: 'phone', w: 390, h: 844, wide: false },
  { name: 'large-phone', w: 430, h: 932, wide: false },
  { name: 'tablet-portrait', w: 820, h: 1180, wide: true },
  { name: 'tablet-landscape', w: 1180, h: 820, wide: true },
  { name: 'desktop', w: 1440, h: 900, wide: true },
  { name: 'wide', w: 1920, h: 1080, wide: true },
];

const fails: string[] = [];
const ok = (c: unknown, m: string) => (c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m)));

/** Everything one viewport can tell us, read in one round trip. */
function probe() {
  const de = document.documentElement;
  const css = getComputedStyle(de);
  const px = (name: string) => parseFloat(css.getPropertyValue(name)) || 0;

  const frame = document.querySelector('.shell-frame') as HTMLElement | null;
  const rect = frame?.getBoundingClientRect();
  const frameStyle = frame ? getComputedStyle(frame) : null;

  return {
    deskMin: px('--desk-min'),
    deskPad: px('--desk-pad'),
    contentMax: px('--desk-content-w'),
    frameMax: css.getPropertyValue('--frame-max').trim(),
    frameW: rect ? Math.round(rect.width) : -1,
    frameLeft: rect ? Math.round(rect.left) : -1,
    // The window card is the layout that has a radius; the phone column has none. A
    // computed length rather than a class, so this measures what the SHEETS did, not what
    // the component asked for.
    frameRadius: frameStyle ? Math.round(parseFloat(frameStyle.borderTopLeftRadius) || 0) : -1,
    // Set by src/app/Shell.tsx on every build that may enter desktop mode. Its absence in
    // the extension is what keeps a dragged-wide side panel a single column.
    deskCapable: !!document.querySelector('.shell-root.has-desktop-mode'),
    overflowX: de.scrollWidth - window.innerWidth,
    overflowY: de.scrollHeight - window.innerHeight,
  };
}

const browser = await chromium.launch();

async function measure(w: number, h: number) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-ES' });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.getByText('Crear una wallet nueva').waitFor({ timeout: 20000 });
  await page.waitForTimeout(SETTLE_MS);
  const m = await page.evaluate(probe);
  return { m, page, ctx };
}

try {
  for (const s of SIZES) {
    const { m, page, ctx } = await measure(s.w, s.h);

    ok(m.overflowX <= 1, `${s.name}: no horizontal overflow (${m.overflowX}px)`);
    ok(m.overflowY <= 1, `${s.name}: no vertical overflow (${m.overflowY}px)`);
    ok(m.deskCapable, `${s.name}: the web build declares itself desktop-capable`);

    if (s.w >= m.deskMin) {
      // Window mode. No session on the welcome screen, so there is no rail and the card is
      // exactly the column — see --desk-content-w in theme.css.
      ok(m.frameRadius > 0, `${s.name}: the frame is a window card (radius ${m.frameRadius}px)`);
      ok(m.frameW <= m.contentMax + 2, `${s.name}: railless card stays column-width (${m.frameW}px)`);
      ok(m.frameLeft >= m.deskPad - 1, `${s.name}: the card floats off the edge (${m.frameLeft}px)`);
    } else {
      ok(m.frameRadius === 0, `${s.name}: still a phone column, no card (radius ${m.frameRadius}px)`);
      if (s.wide) ok(m.frameW > 460, `${s.name}: column widened past phone size (${m.frameW}px)`);
      else ok(m.frameW <= 440, `${s.name}: column fits the phone width (${m.frameW}px)`);
      ok(m.frameW <= 640, `${s.name}: column stays capped (${m.frameW}px)`);
    }

    if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-${s.name}.png` });
    await ctx.close();
  }

  /* ---------------- the breakpoint itself ---------------- */

  const { m: seed, ctx: seedCtx } = await measure(1440, 900);
  await seedCtx.close();
  ok(seed.deskMin > 0, `--desk-min is readable (${seed.deskMin}px)`);

  const below = await measure(seed.deskMin - 1, 900);
  ok(below.m.frameRadius === 0, `one pixel below --desk-min is still a column (${seed.deskMin - 1}px)`);
  await below.ctx.close();

  const at = await measure(seed.deskMin, 900);
  ok(at.m.frameRadius > 0, `--desk-min itself is the window (${seed.deskMin}px)`);
  await at.ctx.close();
} catch (e) {
  fails.push('exception: ' + (e as Error).message);
  console.log('✗ exception:', (e as Error).message);
} finally {
  await browser.close();
  console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
}
