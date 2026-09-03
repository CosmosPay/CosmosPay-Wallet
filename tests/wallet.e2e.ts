/**
 * End-to-end smoke test of the security-critical wallet path, in a real browser.
 *
 *   Terminal 1:  npm run build && npm run serve:dist
 *   Terminal 2:  npm run test:e2e
 *
 * Validates (with zero mocks): SEP-5 key derivation in the browser, AES-GCM/PBKDF2
 * vault sealing, persistence across reload, decrypt-on-unlock, and wrong-password
 * rejection. Uses the official SEP-5 test vector so the derived key is deterministic.
 */
import { chromium } from 'playwright';

const URL = process.env.E2E_URL || 'http://127.0.0.1:4321';
const MNEMONIC = 'illness spike retreat truth genius clock brain pass fit cave bargain toe';
const EXPECTED_PUB = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

const fails: string[] = [];
const ok = (c: unknown, m: string) =>
  c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m));

const browser = await chromium.launch();
// es-ES locale so i18n auto-detects Spanish and the selectors below match.
const page = await browser.newContext({ viewport: { width: 440, height: 880 }, locale: 'es-ES' }).then((c) => c.newPage());
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.getByText('Crear una wallet nueva').waitFor({ timeout: 20000 });
  ok(true, 'Welcome renders');

  // create flow generates a seed in-browser (bip39 + SEP-5)
  await page.getByText('Crear una wallet nueva').click();
  await page.getByText('Frase de recuperación', { exact: false }).first().waitFor();
  ok((await page.locator('text=/^[a-z]{3,}$/').count()) >= 12, 'Seed phrase generated in browser');

  // import the deterministic test vector
  await page.getByText('‹', { exact: true }).first().click(); // back to welcome
  await page.getByText('Ya tengo una wallet').click();
  await page.locator('textarea').fill(MNEMONIC);
  await page.getByRole('button', { name: 'Importar wallet' }).click();

  // profile step: name + email + a valid 13+ birthdate + a gender pick are all
  // required to enable "Continuar" (the two consent checkboxes are optional).
  await page.getByText('¿Cómo te llamas?').waitFor({ timeout: 8000 });
  await page.getByPlaceholder('p. ej. Alex').fill('Test User');
  await page.getByPlaceholder('tu@correo.com').fill('test@cosmos.com');
  await page.locator('input[type="date"]').fill('1990-05-15');
  await page.getByRole('button', { name: 'Masculino' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  ok(true, 'Profile step (name/email/dob/gender) captured');

  // seal vault
  await page.getByText('Crea una contraseña').waitFor();
  await page.getByPlaceholder('Mínimo 12 caracteres').fill('Test-pass-123');
  await page.getByPlaceholder('Repite la contraseña').fill('Test-pass-123');
  await page.getByRole('button', { name: 'Crear wallet' }).click();
  await page.getByRole('button', { name: 'Ver mi wallet' }).waitFor({ timeout: 10000 });

  const wallets = JSON.parse((await page.evaluate(() => localStorage.getItem('cosmos.wallets'))) || '[]');
  ok(wallets[0]?.publicKey === EXPECTED_PUB, 'Derived pubkey matches SEP-5 vector');
  ok(wallets[0]?.name === 'Test User', 'User name stored in wallet list');
  ok(wallets[0]?.email === 'test@cosmos.com', 'User email stored in wallet list');
  const sealed = await page.evaluate(() => {
    const a = localStorage.getItem('cosmos.active');
    return a ? !!localStorage.getItem('cosmos.w.' + a) : false;
  });
  ok(sealed, 'Encrypted vault persisted');

  await page.getByRole('button', { name: 'Ver mi wallet' }).click();
  await page.getByText('Valor del portafolio').waitFor({ timeout: 10000 });
  ok(true, 'Home renders');

  // reload -> must require unlock (greets by name, no address/network), then decrypt
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Desbloquear' }).waitFor({ timeout: 10000 });
  ok((await page.getByText('Test User').count()) > 0, 'Unlock greets by name');
  ok((await page.getByText('Red', { exact: false }).count()) === 0, 'Unlock hides network');
  await page.getByPlaceholder('Contraseña').fill('wrong');
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await page.waitForTimeout(700);
  ok((await page.getByRole('button', { name: 'Desbloquear' }).count()) > 0, 'Wrong password rejected');

  await page.getByPlaceholder('Contraseña').fill('Test-pass-123');
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await page.getByText('Valor del portafolio').waitFor({ timeout: 10000 });
  ok(true, 'Reload -> unlock (decrypt) -> home');

  /* ------------------------- desktop navigation ------------------------- */
  /**
   * The one place the navigation rail can be seen at all.
   *
   * It is tied to the SESSION rather than to the viewport (src/app/Shell.tsx says why), so
   * tests/responsive.e2e.ts — which measures the welcome screen — never has one to look at.
   * By this point the wallet is unlocked and on Home, so widening the window is the whole
   * setup cost.
   *
   * What matters is that EXACTLY ONE navigation is visible at each width. Two would be two
   * things claiming to say where the user is; zero would be a wallet with no way out of the
   * screen it is on, and both failures are invisible to a build that compiles.
   */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400); // let the media query settle before measuring
  const wide = await page.evaluate(() => {
    const shown = (sel: string) => {
      const el = document.querySelector(sel);
      return !!el && getComputedStyle(el).display !== 'none';
    };
    return {
      rail: shown('.shell-side'),
      bar: shown('.bottom-nav'),
      active: document.querySelector('.desk-nav-item.is-on')?.textContent?.trim() ?? '',
    };
  });
  ok(wide.rail, 'Desktop: the navigation rail is visible');
  ok(!wide.bar, 'Desktop: the bottom tab bar is hidden — only one navigation at a time');
  ok(wide.active === 'Inicio', `Desktop: the rail marks the current tab (${wide.active || 'none'})`);

  await page.setViewportSize({ width: 440, height: 880 });
  await page.waitForTimeout(400);
  const narrow = await page.evaluate(() => {
    const shown = (sel: string) => {
      const el = document.querySelector(sel);
      return !!el && getComputedStyle(el).display !== 'none';
    };
    return { rail: shown('.shell-side'), bar: shown('.bottom-nav') };
  });
  ok(narrow.bar, 'Phone: the bottom tab bar is back');
  ok(!narrow.rail, 'Phone: the rail is hidden — the switch goes both ways');
} catch (e) {
  const msg = (e as Error).message;
  fails.push('exception: ' + msg);
  console.log('✗ exception:', msg);
} finally {
  ok(pageErrors.length === 0, `no page errors (${pageErrors.length})`);
  await browser.close();
  console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASSED');
  process.exit(fails.length ? 1 : 0);
}
