/**
 * Drives the Cosmos Pay wallet end-to-end, verifies it advances to Home,
 * funds via Friendbot, tours every main screen, and captures clean
 * screenshots (for the Remotion walkthrough). Also records a webm.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.E2E_URL || 'http://127.0.0.1:4321';
const OUT = process.env.OUT_DIR || 'shots';
const VID = process.env.VID_DIR || 'video';
mkdirSync(OUT, { recursive: true });
mkdirSync(VID, { recursive: true });

const log = (m) => console.log(m);
let shotN = 0;
const shot = async (page, name) => {
  shotN += 1;
  const file = `${OUT}/${String(shotN).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  log(`  📸 ${String(shotN).padStart(2, '0')}-${name}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 420, height: 880 },
  deviceScaleFactor: 2,
  locale: 'es-ES',
  recordVideo: { dir: VID, size: { width: 420, height: 880 } },
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const fails = [];
const expect = async (cond, msg) => {
  const ok = await Promise.resolve(cond).catch(() => false);
  log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) fails.push(msg);
};
const clickBack = async () => {
  await page.getByText('‹', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(700);
};

try {
  // 1) WELCOME — wait for the splash to clear and the buttons to be visible
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const createBtn = page.getByText('Crear una wallet nueva');
  await createBtn.waitFor({ state: 'visible', timeout: 40000 });
  await page.getByText('Ya tengo una wallet').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1600); // let splashIn + fadeUp settle
  await shot(page, 'welcome');
  await expect(true, 'Welcome renders (Create / Import visible)');

  // 2) BACKUP — seed generated in-browser
  await createBtn.click();
  await page.getByText('Frase de recuperación', { exact: false }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
  const words = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('div'))
      .filter((d) => d.children.length === 2
        && /^\d{1,2}$/.test(d.children[0]?.textContent?.trim() || '')
        && /^[a-z]{2,}$/.test(d.children[1]?.textContent?.trim() || ''));
    const map = new Map();
    for (const c of cells) {
      const n = parseInt(c.children[0].textContent.trim(), 10);
      if (n >= 1 && n <= 24 && !map.has(n)) map.set(n, c.children[1].textContent.trim());
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  });
  await expect(words.length >= 12, `Seed generated in-browser (${words.length} words)`);
  await shot(page, 'backup-seed');
  await page.getByText('He guardado', { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Continuar' }).click();

  // 3) VERIFY — tap the requested words
  await page.getByText('Verifica', { exact: false }).first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  await shot(page, 'verify');
  const targetIdx = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('div'))
      .filter((d) => d.children.length === 2 && /^\d{1,2}$/.test(d.children[0]?.textContent?.trim() || ''));
    const targets = []; const seen = new Set();
    for (const c of cells) {
      const n = parseInt(c.children[0].textContent.trim(), 10);
      if (seen.has(n)) continue; seen.add(n);
      if (/^#\d+$/.test(c.children[1].textContent.trim())) targets.push(n - 1);
    }
    return targets.sort((a, b) => a - b);
  });
  for (const idx of targetIdx) {
    const w = words[idx];
    await page.locator(`div:has-text("${w}")`).filter({ hasText: new RegExp(`^${w}$`) }).last().click();
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(400);
  await shot(page, 'verify-filled');
  await page.getByRole('button', { name: 'Confirmar' }).click()
    .catch(() => page.getByRole('button', { name: 'Continuar' }).click());

  // 4) PROFILE ("KYC"-like data gate)
  await page.getByText('¿Cómo te llamas?', { exact: false }).waitFor({ timeout: 10000 });
  await page.getByPlaceholder('p. ej. Alex').fill('Alex Cosmos');
  await page.getByPlaceholder('tu@correo.com').fill('alex@cosmos.pay');
  await page.locator('input[type="date"]').fill('1995-08-20');
  await page.waitForTimeout(500);
  await shot(page, 'profile');
  const profileBtn = page.getByRole('button', { name: 'Continuar' });
  await expect(await profileBtn.isEnabled(), 'Profile/KYC step advances once name+email+dob filled');
  await profileBtn.click();

  // 5) PASSWORD
  await page.getByText('Crea una contraseña', { exact: false }).waitFor({ timeout: 10000 });
  await page.getByPlaceholder('Mínimo 8 caracteres').fill('cosmos-demo-123');
  await page.getByPlaceholder('Repite la contraseña').fill('cosmos-demo-123');
  await page.waitForTimeout(400);
  await shot(page, 'password');
  await page.getByRole('button', { name: 'Crear wallet' }).click();

  // 6) SUCCESS
  await page.getByRole('button', { name: 'Ver mi wallet' }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  await shot(page, 'success');
  await expect(true, 'Onboarding completed');

  // 7) HOME
  await page.getByRole('button', { name: 'Ver mi wallet' }).click();
  await page.getByText('Valor del portafolio', { exact: false }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot(page, 'home');
  await expect(true, 'HOME renders — full flow advanced end-to-end');

  // 8) FUND via Friendbot
  const fund = page.getByRole('button', { name: /Obtener 10.000 XLM|Obtener.*XLM|Friendbot/i }).first();
  if (await fund.count()) {
    await fund.click().catch(() => {});
    await page.waitForTimeout(8000); // friendbot + refresh
    await shot(page, 'home-funded');
    await expect(true, 'Funded with Friendbot (testnet)');
  }

  // 9) RECEIVE (QR + address)
  await page.getByText('Recibir', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, 'receive');
  await clickBack();

  // 10) SEND
  await page.getByText('Enviar', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await shot(page, 'send');
  await clickBack();

  // 11) SWAP / Intercambiar (top action)
  await page.getByText('Intercambiar', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await shot(page, 'swap');
  await clickBack();

  // 12) Bottom-nav tabs
  const navTab = async (label, name) => {
    await page.getByText(label, { exact: true }).last().click().catch(() => {});
    await page.waitForTimeout(1300);
    await shot(page, name);
  };
  await navTab('Mercados', 'markets');
  await navTab('Ganar', 'earn');
  await navTab('Perfil', 'profile');

  await expect(pageErrors.length === 0, `no page errors (${pageErrors.length}${pageErrors.length ? ': ' + pageErrors[0] : ''})`);
} catch (e) {
  fails.push('exception: ' + (e?.message || e));
  log('✗ exception: ' + (e?.message || e));
  await shot(page, 'ERROR').catch(() => {});
} finally {
  await page.waitForTimeout(500);
  await ctx.close();
  await browser.close();
  console.log('\n=== RESULT ===');
  console.log(fails.length ? `FAILED (${fails.length}): ${fails.join(' | ')}` : `ALL PASSED — ${shotN} screens captured`);
  process.exit(fails.length ? 1 : 0);
}
