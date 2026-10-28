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

  // create flow generates a seed in-browser (bip39 + SEP-5): Welcome -> how to back it up
  // -> the twelve words
  await page.getByText('Crear una wallet nueva').click();
  ok((await page.getByRole('radio', { name: 'Mi cuenta' }).getAttribute('aria-checked')) === 'true', 'The account backup is chosen first');
  await page.getByRole('radio', { name: '12 palabras' }).click();
  await page.getByRole('button', { name: 'Continuar con 12 palabras' }).click();
  await page.getByText('Frase de recuperación', { exact: false }).first().waitFor();
  ok((await page.locator('text=/^[a-z]{3,}$/').count()) >= 12, 'Seed phrase generated in browser');

  // The flow is browser history too (src/lib/navHistory.ts): back and forward walk it one step
  // at a time, and a step comes back showing what it showed.
  const words = await page.locator('.ob-word-text').allTextContents();
  await page.goBack();
  await page.getByRole('radio', { name: '12 palabras' }).waitFor();
  ok(true, 'Browser back returns to the backup choice');
  await page.goForward();
  await page.getByText('Frase de recuperación', { exact: false }).first().waitFor();
  ok((await page.locator('.ob-word-text').allTextContents()).join() === words.join(), 'Browser forward shows the same words');

  // import the deterministic test vector: back twice (the words, the choice) to Welcome,
  // then "I already have one" -> with my 12 words
  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByRole('button', { name: 'Volver' }).click();
  await page.getByText('Ya tengo una wallet').click();
  await page.getByRole('button', { name: 'Con mis 12 palabras' }).click();
  await page.locator('textarea').fill(MNEMONIC);
  await page.getByRole('button', { name: 'Importar wallet' }).click();

  // profile, one question per step: the name, the email, a valid 13+ birthdate and a
  // gender pick, then the two optional consents. Each step is a stop in the history.
  await page.getByText('¿Cómo te llamas?').waitFor({ timeout: 8000 });
  ok(await page.getByText('Paso 1 de 4').isVisible(), 'Profile: the steps say where the person is');
  ok(await page.getByRole('button', { name: 'Continuar' }).isDisabled(), 'Profile: no name, no next step');
  await page.getByPlaceholder('p. ej. Alex').fill('Test User');
  await page.getByPlaceholder('p. ej. Alex').press('Enter');
  await page.getByPlaceholder('tu@correo.com').waitFor();
  ok(true, 'Profile: Enter in the field goes on');
  await page.getByPlaceholder('tu@correo.com').fill('test@cosmos.com');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.locator('input[type="date"]').fill('1990-05-15');
  await page.getByRole('button', { name: 'Masculino' }).click();
  await page.goBack();
  ok((await page.getByPlaceholder('tu@correo.com').inputValue()) === 'test@cosmos.com', 'Profile: back walks the steps and keeps what was typed');
  await page.goForward();
  ok((await page.locator('input[type="date"]').inputValue()) === '1990-05-15', 'Profile: forward returns to the step, still filled');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Opcionales' }).waitFor();
  await page.getByRole('button', { name: 'Continuar' }).click();
  ok(true, 'Profile steps (name, email, dob/gender, optional) captured');

  // seal vault. Where the browser can make a passkey the screen offers one first; this
  // suite is about the password vault, so it takes the password.
  const pwdInstead = page.getByRole('button', { name: 'Prefiero una contraseña' });
  await page.getByText('Crea una contraseña').or(pwdInstead).first().waitFor();
  if (await pwdInstead.isVisible()) await pwdInstead.click();
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

  // A finished flow is not walked back into: forward from success stays on it.
  await page.goForward();
  await page.waitForTimeout(600);
  ok((await page.getByRole('button', { name: 'Ver mi wallet' }).count()) === 1, 'Forward from success does not re-enter the flow');

  await page.getByRole('button', { name: 'Ver mi wallet' }).click();
  await page.getByText('Saldo total').waitFor({ timeout: 10000 });
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
  await page.getByText('Saldo total').waitFor({ timeout: 10000 });
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
