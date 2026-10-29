/**
 * Easy recovery end to end: a wallet moves from one device to another with a QR and a
 * 5-digit code (src/lib/easyRecovery.ts), in two real browsers, against an in-memory stand-in
 * for the community server's mailbox (`/v1/wallet/easy-recovery/*`).
 *
 *   npm run build && npx astro preview     # then, in another shell:
 *   npm run test:e2e:easy-recovery
 *
 * Everything the wallets do is real — the X25519 keys, the sealing, the import — and only the
 * mailbox is answered here, which is also what lets the test check what the server would see:
 * a sealed payload and a code, never the phrase.
 */
import { chromium, type BrowserContext, type Page, type Route } from 'playwright';

const URL = process.env.E2E_URL || 'http://127.0.0.1:4321';
const MNEMONIC = 'illness spike retreat truth genius clock brain pass fit cave bargain toe';
const EXPECTED_PUB = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const PASSWORD = 'Test-pass-123';
const fails: string[] = [];
const ok = (c: unknown, m: string) => (c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m)));

/* ------------------------------ the mailbox ------------------------------ */

interface Session {
  receiverKey: string;
  status: 'open' | 'offered' | 'claimed';
  ciphertext: string | null;
  code: string | null;
  attempts: number;
  expiresAt: number;
}
const sessions = new Map<string, Session>();
const seen: string[] = [];

async function mailbox(ctx: BrowserContext) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json',
  };
  const send = (route: Route, data: unknown, status = 200) => route.fulfill({ status, headers: cors, body: JSON.stringify(data) });
  // A server without the sign-in routes: the profile's email code is never sent anywhere (a
  // built app would otherwise ask the real gateway to email the test address).
  await ctx.route('**/v1/wallet/auth/**', (route) =>
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : send(route, {}, 404),
  );
  // And no public key either, the local stack with its server stopped: the account step must
  // let the person go on, not show the gateway's "Missing API key".
  await ctx.route('**/v1/public-key*', (route) => send(route, { message: 'Missing API key in request' }, 401));
  await ctx.route('**/v1/wallet/easy-recovery/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postData() || '';
    seen.push(body);
    const parts = new globalThis.URL(req.url()).pathname.split('/');
    const i = parts.indexOf('sessions');
    const id = parts[i + 1];
    const action = parts[i + 2];
    if (!id && req.method() === 'POST') {
      const { receiverKey } = JSON.parse(body) as { receiverKey: string };
      const newId = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
      sessions.set(newId, { receiverKey, status: 'open', ciphertext: null, code: null, attempts: 0, expiresAt: Date.now() + 300_000 });
      return send(route, { id: newId, expiresAt: new Date(Date.now() + 300_000).toISOString() }, 201);
    }
    const s = sessions.get(id);
    if (!s || s.expiresAt < Date.now()) return send(route, { code: 'EASY_RECOVERY_NOT_FOUND' }, 404);
    if (!action) return send(route, { status: s.status, expiresAt: new Date(s.expiresAt).toISOString() });
    if (action === 'offer') {
      if (s.status !== 'open') return send(route, { code: 'EASY_RECOVERY_ALREADY_OFFERED' }, 409);
      const { ciphertext, code } = JSON.parse(body) as { ciphertext: string; code: string };
      Object.assign(s, { ciphertext, code, status: 'offered' });
      return send(route, { status: 'offered' });
    }
    if (action === 'claim') {
      if (s.status === 'open') return send(route, { code: 'EASY_RECOVERY_NOT_OFFERED' }, 409);
      if (s.status !== 'offered') return send(route, { code: 'EASY_RECOVERY_NOT_FOUND' }, 404);
      const { code } = JSON.parse(body) as { code: string };
      if (code !== s.code) {
        s.attempts++;
        if (s.attempts >= 5) {
          sessions.delete(id);
          return send(route, { code: 'EASY_RECOVERY_BURNED' }, 410);
        }
        return send(route, { code: 'EASY_RECOVERY_CODE_INVALID', attemptsLeft: 5 - s.attempts }, 422);
      }
      const ciphertext = s.ciphertext;
      Object.assign(s, { status: 'claimed', ciphertext: null, code: null });
      return send(route, { ciphertext });
    }
    return send(route, {}, 404);
  });
}

/* ------------------------------- the devices ------------------------------ */

async function open(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('page error: ' + e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.getByText('Crear una wallet nueva').waitFor({ timeout: 30000 });
  await page.waitForTimeout(2600); // the splash
  return page;
}

/** Profile + password: the end of any import. */
async function finishImport(page: Page, name: string) {
  await page.getByText('¿Cómo te llamas?').waitFor({ timeout: 10000 });
  // One question per step: name, email, age and gender, the optional consents.
  const nameField = page.getByPlaceholder('p. ej. Alex');
  if (!(await nameField.inputValue())) await nameField.fill(name);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByPlaceholder('tu@correo.com').fill('test@cosmos.com');
  await page.getByRole('button', { name: 'Continuar' }).click();
  // No sign-in server here (its routes answer 404), so the code cannot be sent: the step says
  // so and the person goes on to the next question, the account left for Home.
  await page.getByRole('button', { name: 'Seguir sin cuenta por ahora' }).click();
  await page.locator('input[type="date"]').fill('1990-05-15');
  await page.getByRole('button', { name: 'Masculino' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Opcionales' }).waitFor();
  await page.getByRole('button', { name: 'Continuar' }).click();
  const pwdInstead = page.getByRole('button', { name: 'Prefiero una contraseña' });
  await page.getByText('Crea una contraseña').or(pwdInstead).first().waitFor();
  if (await pwdInstead.isVisible()) await pwdInstead.click();
  await page.getByPlaceholder('Mínimo 12 caracteres').fill(PASSWORD);
  await page.getByPlaceholder('Repite la contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear wallet' }).click();
  await page.getByRole('button', { name: 'Ver mi wallet' }).waitFor({ timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch();
  const ctxOld = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ctxNew = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await mailbox(ctxOld);
  await mailbox(ctxNew);

  // OLD device: a wallet, imported from the test vector.
  const oldPage = await open(ctxOld);
  await oldPage.getByText('Ya tengo una wallet').click();
  await oldPage.getByRole('button', { name: 'Con mis 12 palabras' }).click();
  await oldPage.locator('textarea').fill(MNEMONIC);
  await oldPage.getByRole('button', { name: 'Importar wallet' }).click();
  await finishImport(oldPage, 'Ada');
  await oldPage.getByRole('button', { name: 'Ver mi wallet' }).click();
  ok(true, 'old device holds the wallet');
  // The account was left for later, so Home offers it (wallet.e2e.ts checks the other side).
  await oldPage.getByText('Conecta Cosmos Pay').waitFor({ timeout: 10000 });
  ok(true, 'a wallet made without its account is offered one on Home');

  // NEW device: "I already have one" → from another Cosmos Wallet → the QR.
  const newPage = await open(ctxNew);
  await newPage.getByText('Ya tengo una wallet').click();
  await newPage.getByRole('button', { name: /Desde otra Cosmos Wallet/ }).click();
  await newPage.getByAltText(/Código QR/).waitFor({ timeout: 10000 });
  ok(true, 'new device shows the QR');
  await newPage.getByRole('button', { name: 'Copiar el enlace' }).click();
  const link = await newPage.evaluate(() => navigator.clipboard.readText());
  ok(link.startsWith('cosmos-easy-recovery:v1?'), 'the QR carries an easy-recovery link');
  ok(!/https?:/.test(link), 'the QR names no server');

  // OLD device: the Wallet tab → transfer to another device → paste the link → confirm → unlock.
  await oldPage.evaluate(() => window.scrollTo(0, 0));
  await oldPage.locator('nav.bottom-nav:visible, nav.shell-side:visible').first().getByRole('button', { name: 'Wallet', exact: true }).click();
  await oldPage.getByRole('button', { name: /Transferir a otro dispositivo/ }).click();
  await oldPage.getByPlaceholder('cosmos-easy-recovery:v1?…').fill('not a link');
  await oldPage.getByRole('button', { name: 'Usar este enlace' }).click();
  ok(await oldPage.getByText('Ese no es un código de Cosmos Wallet').isVisible(), 'a pasted non-link is refused in place');
  await oldPage.getByPlaceholder('cosmos-easy-recovery:v1?…').fill(link);
  await oldPage.getByRole('button', { name: 'Usar este enlace' }).click();
  await oldPage.getByText('¿Transferir tu wallet?').waitFor();
  const sendBtn = oldPage.getByRole('button', { name: 'Transferir mi wallet' });
  ok(await sendBtn.isDisabled(), 'nothing is sent before the person says the device is theirs');
  await oldPage.getByText('El otro dispositivo es mío y lo tengo delante.').click();
  await oldPage.locator('input[type="password"]').fill('wrong-password-1');
  await sendBtn.click();
  await oldPage.getByText('Esa contraseña no abre esta wallet.').waitFor();
  ok(true, 'a wrong password is said in place, nothing sent');
  ok(![...sessions.values()].some((s) => s.status !== 'open'), 'the mailbox got nothing on a wrong password');
  await oldPage.locator('input[type="password"]').fill(PASSWORD);
  await sendBtn.click();
  await oldPage.getByText('Escribe este código en el otro dispositivo').waitFor({ timeout: 10000 });
  const code = (await oldPage.locator('.easy-send-digit').allTextContents()).join('');
  ok(/^\d{5}$/.test(code), 'the old device shows a 5-digit code');
  ok(!seen.some((b) => b.includes('illness') || b.includes(EXPECTED_PUB)), 'the server never sees the phrase or the address');

  // NEW device: the code step arrives by itself; a wrong code, then the right one.
  await newPage.getByText('Escribe el código').waitFor({ timeout: 10000 });
  ok(true, 'the new device moves to the code step on its own');
  const wrong = code === '00000' ? '11111' : '00000';
  await newPage.locator('.easy-receive-code').fill(wrong);
  await newPage.getByRole('button', { name: 'Recuperar mi wallet' }).click();
  await newPage.getByText('Te quedan 4 intentos').waitFor();
  ok(true, 'a wrong code is said in place with the tries left');
  await newPage.locator('.easy-receive-code').fill(code);
  await newPage.getByRole('button', { name: 'Recuperar mi wallet' }).click();
  await finishImport(newPage, 'Ignored');
  const wallets = JSON.parse((await newPage.evaluate(() => localStorage.getItem('cosmos.wallets'))) || '[]');
  ok(wallets[0]?.publicKey === EXPECTED_PUB, 'the new device has the SAME wallet');
  ok(wallets[0]?.name === 'Ada', 'its name came across too');

  // OLD device: sees it was taken.
  await oldPage.getByText('Tu wallet ya está en el otro dispositivo').waitFor({ timeout: 10000 });
  ok(true, 'the old device sees the transfer done');

  // The session is spent: claiming again finds nothing.
  ok([...sessions.values()].every((s) => s.ciphertext === null), 'the mailbox keeps no payload after the claim');

  await browser.close();
  if (fails.length) {
    console.log(`\n${fails.length} FAILED`);
    process.exit(1);
  }
  console.log('\nALL PASSED');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
