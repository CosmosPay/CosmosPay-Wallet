/**
 * The wallet's own sign-in, end to end in a real browser, against a mocked community server.
 *
 *   npm run build && npm run serve:dist     # then, in another shell:
 *   npm run test:e2e:signin
 *
 * Two devices, one account. The first signs in by email, creates a wallet and uploads its
 * backup; the second signs in as the same person and restores THAT wallet from the box the
 * first one uploaded. Everything the wallet does is real — the SEP-5 seed, the PBKDF2 +
 * AES-GCM backup, the signatures — and only `/v1/wallet/auth/*` is answered by this file,
 * which is also what lets it inspect exactly what the wallet sent.
 *
 * What it proves that no unit test can: that the screens route a sign-in the way
 * `routeSignIn` says, that a wrong backup password is refused before anything reaches the
 * server, and that the second device ends up with the SAME address as the first.
 */
import { chromium, type Page, type Route } from 'playwright';

const URL = process.env.E2E_URL || 'http://127.0.0.1:4321';
const PASSWORD = 'Test-pass-123';
const fails: string[] = [];
const ok = (c: unknown, m: string) => (c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m)));

interface Captured {
  body: Record<string, unknown>;
  auth: string | null;
}

/** Answer the community server's sign-in routes. `ready` is what a correct code proves. */
async function mockServer(page: Page, ready: (email: string) => unknown, finishes: Captured[]) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Content-Type': 'application/json',
  };
  // Bare bodies, as the community server answers — no `{ data }` envelope.
  const env = (data: unknown, code = 200) => ({
    status: code,
    headers: cors,
    body: JSON.stringify(data),
  });
  await page.route('**/v1/wallet/auth/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new globalThis.URL(req.url()).pathname;
    if (path.endsWith('/providers')) return route.fulfill(env({ providers: ['google', 'github'], email: true }));
    if (path.endsWith('/email/start')) {
      return route.fulfill(env({ status: 'sent', claimToken: 'c'.repeat(43), expiresInSeconds: 900 }, 201));
    }
    if (path.endsWith('/email/verify')) {
      const { code } = JSON.parse(req.postData() || '{}') as { code?: string };
      if (code !== '123456') return route.fulfill(env({ status: 'invalid', attemptsLeft: 4 }));
      return route.fulfill(env(ready('ada@example.com')));
    }
    if (path.endsWith('/finish')) {
      finishes.push({ body: JSON.parse(req.postData() || '{}'), auth: req.headers()['authorization'] ?? null });
      return route.fulfill(env({ status: 'ready', account: 'created', organizationId: 'org_1', keys: { dev: 'k_dev', prod: null } }));
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
}

/** Welcome → sign-in → email → a wrong code, then the right one. */
async function signInWithEmail(page: Page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.getByText('Entrar con Google, GitHub o email').click();
  await page.getByRole('button', { name: 'Continuar con Google' }).waitFor({ timeout: 10000 });
  ok(await page.getByRole('button', { name: 'Continuar con GitHub' }).isVisible(), 'the providers the server offers are shown');
  await page.getByPlaceholder('nombre@email.com').fill('ada@example.com');
  await page.getByRole('button', { name: 'Continuar con email' }).click();
  await page.getByText('Revisá tu correo').waitFor({ timeout: 10000 });
  const code = page.locator('input[autocomplete="one-time-code"]');
  await code.fill('000000');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByText('Código incorrecto. Te quedan 4 intentos.').waitFor({ timeout: 5000 });
  ok(true, 'a wrong code keeps the prompt and says how many tries are left');
  await code.fill('123456');
  await page.getByRole('button', { name: 'Confirmar' }).click();
}

// E2E_CHANNEL=chrome runs it on an installed Chrome instead of Playwright's own build.
const browser = await chromium.launch(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {});
const pageErrors: string[] = [];
try {
  /* ------------------------------ device A: a new wallet ------------------------------ */
  const a = await browser.newContext({ viewport: { width: 440, height: 880 }, locale: 'es-ES' }).then((c) => c.newPage());
  a.on('pageerror', (e) => pageErrors.push(e.message));
  const finishesA: Captured[] = [];
  await mockServer(
    a,
    (email) => ({
      status: 'ready',
      identity: { email, name: null, avatar: null, method: 'email' },
      account: 'new',
      backup: null,
      sessionToken: 'tok-A',
      expiresInSeconds: 1800,
    }),
    finishesA,
  );
  await signInWithEmail(a);
  await a.getByText('Esta contraseña protege tu wallet en este dispositivo', { exact: false }).waitFor({ timeout: 10000 });
  ok(true, 'a first-run sign-in with no backup asks for a new password');
  const pwds = a.locator('input[type="password"]');
  await pwds.nth(0).fill(PASSWORD);
  await pwds.nth(1).fill(PASSWORD);
  await a.getByRole('button', { name: 'Continuar' }).click();
  await a.getByRole('button', { name: 'Crear wallet' }).click();
  await a.getByRole('button', { name: 'Ver mi wallet' }).waitFor({ timeout: 30000 });
  ok(true, 'the wallet is created');

  const walletsA = JSON.parse((await a.evaluate(() => localStorage.getItem('cosmos.wallets'))) || '[]');
  const addr: string | undefined = walletsA[0]?.publicKey;
  ok(
    walletsA.length === 1 && walletsA[0].email === 'ada@example.com' && walletsA[0].cloudBackup === true,
    'one wallet, with the proven email, marked as backed up',
  );
  const fa = finishesA[0];
  ok(finishesA.length === 1 && fa.auth === 'Bearer tok-A', 'finish carries the session token');
  ok(fa?.body.stellarAddress === addr && typeof fa?.body.signature === 'string', 'finish is signed by the new address');
  const rawBox = typeof fa?.body.backup === 'string' ? fa.body.backup : '';
  const box = rawBox ? (JSON.parse(rawBox) as Record<string, unknown>) : null;
  ok(
    box?.v === 2 && box?.iter === 1_000_000 && !rawBox.includes(PASSWORD),
    'the backup is a sealed box at the backup cost, with nothing readable in it',
  );

  /* ------------------------- device B: the same person, restoring ------------------------- */
  const b = await browser.newContext({ viewport: { width: 440, height: 880 }, locale: 'es-ES' }).then((c) => c.newPage());
  b.on('pageerror', (e) => pageErrors.push(e.message));
  const finishesB: Captured[] = [];
  await mockServer(
    b,
    (email) => ({
      status: 'ready',
      identity: { email, name: null, avatar: null, method: 'email' },
      account: 'existing',
      backup: { stellarAddress: addr, box: rawBox, updatedAt: new Date().toISOString() },
      sessionToken: 'tok-B',
      expiresInSeconds: 1800,
    }),
    finishesB,
  );
  await signInWithEmail(b);
  await b.getByText('Recuperar tu wallet').waitFor({ timeout: 10000 });
  ok(true, 'an account with a backup is sent to restore it');
  const pwd = b.locator('input[type="password"]');
  await pwd.fill('Wrong-pass-999');
  await b.getByRole('button', { name: 'Recuperar' }).click();
  await b.getByText('Esa no es la contraseña de esta wallet.').waitFor({ timeout: 30000 });
  ok(finishesB.length === 0, 'a wrong backup password is refused before anything reaches the server');
  await pwd.fill(PASSWORD);
  await b.getByRole('button', { name: 'Recuperar' }).click();
  await b.getByRole('button', { name: 'Ver mi wallet' }).waitFor({ timeout: 30000 });
  const walletsB = JSON.parse((await b.evaluate(() => localStorage.getItem('cosmos.wallets'))) || '[]');
  ok(walletsB[0]?.publicKey === addr, 'the SAME wallet is restored on the second device');
  ok(
    finishesB.length === 1 && finishesB[0].body.backup === undefined && finishesB[0].body.stellarAddress === addr,
    'a restore finishes without uploading the backup again',
  );
  ok(finishesB[0]?.auth === 'Bearer tok-B', 'the restore uses its own session token');
} catch (e) {
  fails.push('threw: ' + (e as Error).message);
  console.log('✗ threw: ' + (e as Error).message);
} finally {
  await browser.close();
}
ok(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
process.exit(fails.length ? 1 : 0);
