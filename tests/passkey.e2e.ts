/**
 * Passkeys, end to end in a real browser with a real WebAuthn ceremony.
 *
 *   npm run build && npm run serve:dist     # then, in another shell:
 *   npm run test:e2e:passkey
 *
 * Chrome's virtual authenticator (DevTools protocol, `WebAuthn.addVirtualAuthenticator`) is
 * a CTAP2 authenticator with PRF — the same ceremonies a phone or Windows Hello answers, with
 * the user's presence and verification simulated. Nothing about the passkey is mocked; only
 * the community server's `/v1/wallet/auth/*` is, as in `signin.e2e.ts`.
 *
 * One person, one synced passkey, two devices:
 *
 *  1. A first run protected by a passkey: no password anywhere, a backup with ONE door — the
 *     passkey's — and a device door on disk.
 *  2. The lock screen opens with the passkey and shows no password field.
 *  3. A second device (this browser with its storage wiped — the passkey is the synced one)
 *     restores the SAME wallet from that backup with one tap, typing nothing.
 *  4. A wallet made the password way (a v4 box, one password door) is restored with its password, and the
 *     checkbox that is on by default moves the device and the backup to the passkey.
 */
import { chromium, type BrowserContext, type Page, type Route } from 'playwright';

// localhost, not 127.0.0.1: WebAuthn refuses an IP address as a relying party ('This is an
// invalid domain'), and the wallet would correctly fall back to a password.
const URL = process.env.E2E_URL || 'http://localhost:4321';
const fails: string[] = [];
const ok = (c: unknown, m: string) => (c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m)));

interface Captured {
  body: Record<string, unknown>;
}

async function mockServer(page: Page, ready: () => unknown, finishes: Captured[]) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Content-Type': 'application/json',
  };
  const env = (data: unknown, code = 200) => ({ status: code, headers: cors, body: JSON.stringify(data) });
  await page.unroute('**/v1/wallet/auth/**');
  // No recovery servers, as in CI: a developer machine running them (`dev:local -- all` on the
  // community server) would give every box an email door and change what this suite checks.
  // Their discovery is refused, so the wallet sees none, whatever is running locally.
  await page.route('**/.well-known/stellar.toml*', (route: Route) => route.abort());
  await page.route('**/v1/wallet/auth/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new globalThis.URL(req.url()).pathname;
    if (path.endsWith('/providers')) return route.fulfill(env({ providers: [], email: true }));
    if (path.endsWith('/email/start')) {
      return route.fulfill(env({ status: 'sent', claimToken: 'c'.repeat(43), expiresInSeconds: 900 }, 201));
    }
    if (path.endsWith('/email/verify')) return route.fulfill(env(ready()));
    if (path.endsWith('/finish')) {
      finishes.push({ body: JSON.parse(req.postData() || '{}') });
      return route.fulfill(env({ status: 'ready', account: 'created', organizationId: 'org_1', keys: { dev: 'k_dev', prod: null } }));
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
}

/** Welcome -> create -> with my account -> email -> code. Restoring goes through the same
 *  door on purpose: the account decides whether there is a backup to open, so a person who
 *  taps "create" with an account that already has one still gets it back. */
async function signInWithEmail(page: Page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.getByText('Crear una wallet nueva').click();
  await page.getByRole('button', { name: 'Continuar con mi cuenta' }).click();
  await page.getByRole('button', { name: 'Continuar con email' }).click();
  await page.getByPlaceholder('nombre@email.com').fill('ada@example.com');
  await page.getByRole('button', { name: 'Enviar código' }).click();
  await page.locator('input[autocomplete="one-time-code"]').fill('123456');
  await page.getByRole('button', { name: 'Confirmar' }).click();
}

/** A CTAP2.1 platform authenticator with PRF, that says yes without a person. */
async function addAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
}

const browser = await chromium.launch(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {});
const pageErrors: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width: 440, height: 880 }, locale: 'es-ES' });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await addAuthenticator(context, page);

  /* ------------------------- 1. a first run, protected by a passkey ------------------------- */
  const finishesA: Captured[] = [];
  await mockServer(
    page,
    () => ({
      status: 'ready',
      identity: { email: 'ada@example.com', name: null, avatar: null, method: 'email' },
      account: 'new',
      backup: null,
      sessionToken: 'tok-A',
      expiresInSeconds: 1800,
    }),
    finishesA,
  );
  await signInWithEmail(page);
  const create = page.getByRole('button', { name: 'Crear passkey' });
  await create.waitFor({ timeout: 10000 });
  ok(true, 'a first run is offered a passkey first');
  await create.click();
  await page.getByRole('button', { name: 'Ver mi wallet' }).waitFor({ timeout: 30000 });
  ok(true, 'the wallet is created with one passkey sheet and no password');

  const walletsA = JSON.parse((await page.evaluate(() => localStorage.getItem('cosmos.wallets'))) || '[]');
  const addr: string | undefined = walletsA[0]?.publicKey;
  ok(walletsA.length === 1 && walletsA[0].cloudBackup === true, 'one wallet, marked as backed up');
  ok(!!(await page.evaluate(() => localStorage.getItem('cosmos.passkey'))), 'this device has a passkey door');

  const rawBox = typeof finishesA[0]?.body.backup === 'string' ? (finishesA[0].body.backup as string) : '';
  const box = rawBox ? (JSON.parse(rawBox) as { v?: number; slots?: { kind: string }[] }) : null;
  // `v: 4` is what every backup is sealed as (lib/cloudBackup.ts): a data key sealed once per door.
  ok(
    box?.v === 4 && box.slots?.length === 1 && box.slots[0].kind === 'passkey',
    'the backup is a v4 box whose only door is the passkey',
  );

  /* --------------------------- 2. the lock screen opens with it --------------------------- */
  await page.reload({ waitUntil: 'domcontentloaded' });
  const open = page.getByRole('button', { name: 'Abrir con passkey' });
  await open.waitFor({ timeout: 15000 });
  ok((await page.locator('input[type="password"]').count()) === 0, 'the lock screen shows no password field');
  await open.click();
  await open.waitFor({ state: 'detached', timeout: 30000 });
  ok(true, 'the passkey opens the wallet');

  /* ------------------ 3. a new device restores it with the synced passkey ------------------ */
  // The same authenticator — which is what a synced passkey is to the second device — and
  // none of the first device's storage.
  await page.evaluate(() => localStorage.clear());
  const finishesB: Captured[] = [];
  await mockServer(
    page,
    () => ({
      status: 'ready',
      identity: { email: 'ada@example.com', name: null, avatar: null, method: 'email' },
      account: 'existing',
      backup: { stellarAddress: addr, box: rawBox, updatedAt: new Date().toISOString() },
      sessionToken: 'tok-B',
      expiresInSeconds: 1800,
    }),
    finishesB,
  );
  await signInWithEmail(page);
  const restore = page.getByRole('button', { name: 'Recuperar con passkey' });
  await restore.waitFor({ timeout: 10000 });
  ok((await page.locator('input[type="password"]').count()) === 0, 'a passkey-only backup asks for no password');
  await restore.click();
  await page.getByRole('button', { name: 'Ver mi wallet' }).waitFor({ timeout: 30000 });
  const walletsB = JSON.parse((await page.evaluate(() => localStorage.getItem('cosmos.wallets'))) || '[]');
  ok(walletsB[0]?.publicKey === addr, 'the SAME wallet is restored on the new device, with one tap');
  ok(finishesB.length === 1 && finishesB[0].body.backup === undefined, 'the restore uploads no new box');
  ok(!!(await page.evaluate(() => localStorage.getItem('cosmos.passkey'))), 'the new device opens with the passkey too');

  /* ------ 4. an existing password wallet moves to a passkey while restoring it ------ */
  // A wallet made the password way: a v4 box whose one door is the password (Argon2id). Made
  // here on a fresh device, so the box is a real one.
  await page.evaluate(() => localStorage.clear());
  const PASSWORD = 'Test-pass-123';
  const finishesC: Captured[] = [];
  await mockServer(
    page,
    () => ({
      status: 'ready',
      identity: { email: 'bob@example.com', name: null, avatar: null, method: 'email' },
      account: 'new',
      backup: null,
      sessionToken: 'tok-C',
      expiresInSeconds: 1800,
    }),
    finishesC,
  );
  await signInWithEmail(page);
  await page.getByRole('button', { name: 'Prefiero una contraseña' }).click();
  const pwds = page.locator('input[type="password"]');
  await pwds.nth(0).fill(PASSWORD);
  await pwds.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Crear wallet' }).click();
  await page.getByRole('button', { name: 'Ver mi wallet' }).waitFor({ timeout: 30000 });
  const boxC = typeof finishesC[0]?.body.backup === 'string' ? (finishesC[0].body.backup as string) : '';
  const addrC = JSON.parse((await page.evaluate(() => localStorage.getItem('cosmos.wallets'))) || '[]')[0]?.publicKey;
  const parsedC = JSON.parse(boxC || '{}') as { v?: number; slots?: { kind: string; kdf?: string }[] };
  ok(
    parsedC.v === 4 && parsedC.slots?.length === 1 && parsedC.slots[0].kind === 'password' && parsedC.slots[0].kdf === 'argon2id',
    'a password wallet backs up a v4 box behind its password, under Argon2id',
  );
  ok(!(await page.evaluate(() => localStorage.getItem('cosmos.passkey'))), 'and its device has no passkey door');

  // The next device: the password restores it, and the box that is on by default moves this
  // device — and the backup — to the passkey in the same step.
  await page.evaluate(() => localStorage.clear());
  const finishesD: Captured[] = [];
  await mockServer(
    page,
    () => ({
      status: 'ready',
      identity: { email: 'bob@example.com', name: null, avatar: null, method: 'email' },
      account: 'existing',
      backup: { stellarAddress: addrC, box: boxC, updatedAt: new Date().toISOString() },
      sessionToken: 'tok-D',
      expiresInSeconds: 1800,
    }),
    finishesD,
  );
  await signInWithEmail(page);
  await page.getByText('Recuperar tu wallet').waitFor({ timeout: 10000 });
  ok(
    await page.getByText('Usar una passkey en vez de la contraseña a partir de ahora').isVisible(),
    'a password restore offers the move to a passkey',
  );
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Recuperar', exact: true }).click();
  await page.getByRole('button', { name: 'Ver mi wallet' }).waitFor({ timeout: 30000 });
  const upgraded = typeof finishesD[0]?.body.backup === 'string' ? (JSON.parse(finishesD[0].body.backup as string) as { v?: number; slots?: { kind: string }[] }) : null;
  ok(
    upgraded?.v === 4 && upgraded.slots?.map((s) => s.kind).sort().join(',') === 'passkey,password',
    'the backup now has both doors: the password it had, and the passkey',
  );
  ok(finishesD[0]?.body.stellarAddress === addrC, 'for the same account');
  ok(!!(await page.evaluate(() => localStorage.getItem('cosmos.passkey'))), 'and this device opens with the passkey');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Abrir con passkey' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Abrir con passkey' }).click();
  await page.getByRole('button', { name: 'Abrir con passkey' }).waitFor({ state: 'detached', timeout: 30000 });
  ok(true, 'the upgraded device unlocks with the passkey');
} catch (e) {
  fails.push('threw: ' + (e as Error).message);
  console.log('✗ threw: ' + (e as Error).message);
} finally {
  await browser.close();
}
ok(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
process.exit(fails.length ? 1 : 0);
