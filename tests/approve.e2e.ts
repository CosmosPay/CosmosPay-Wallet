/**
 * Smoke test for the dapp-approval window (approve/index.html).
 *
 * A SEPARATE Astro document + React root from the main app, so it must load the
 * Node-compat shim on its own (Buffer/global/process) before the ApprovePopup
 * island hydrates — its signing path uses Buffer.
 *
 *   Terminal 1:  npm run build && npm run serve:dist
 *   Terminal 2:  npm run test:approve
 *
 * Without the extension (no chrome.storage.session) the popup renders its
 * "Solicitud no encontrada" fallback — which is exactly what we assert, along
 * with a clean global scope (Buffer present) and zero page errors.
 */
import { chromium } from 'playwright';

const URL = process.env.E2E_URL || 'http://127.0.0.1:4321';
const fails: string[] = [];
const ok = (c: unknown, m: string) =>
  c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m));

const browser = await chromium.launch();
const page = await browser.newContext({ locale: 'es-ES' }).then((c) => c.newPage());
const pageErrors: string[] = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

try {
  await page.goto(URL + '/approve/index.html', { waitUntil: 'domcontentloaded' });

  // The React root mounts and renders its fallback (no extension => no pending request).
  await page.getByText('Solicitud no encontrada').waitFor({ timeout: 20000 });
  ok(true, 'ApprovePopup React root mounts');

  const globals = await page.evaluate(() => ({
    buffer: typeof globalThis.Buffer,
    global: typeof (globalThis as Record<string, unknown>).global,
    process: typeof (globalThis as Record<string, unknown>).process,
  }));
  ok(globals.buffer === 'function', 'Buffer defined in approval document');
  ok(globals.global === 'object', 'global defined in approval document');
  ok(globals.process === 'object', 'process defined in approval document');
} catch (e) {
  fails.push('exception: ' + (e as Error).message);
  console.log('✗ exception:', (e as Error).message);
} finally {
  ok(pageErrors.length === 0, `no page errors (${pageErrors.length})`);
  await browser.close();
  console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
}
