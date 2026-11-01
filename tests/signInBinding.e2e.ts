/**
 * The device binding of an Authentik emailed sign-in, end to end in a real browser, against a
 * mocked community server.
 *
 *   npm run build && npx astro preview     # then, in another shell:
 *   npm run test:e2e:signin-binding
 *
 * The emailed link proves whose inbox it is; the binding proves the wallet claiming the
 * sign-in is in the browser where the link was opened (src/lib/signInBinding.ts). The server
 * sends it in the fragment of its redirect to the return page (src/pages/signed-in.astro), a
 * tab of its own, which leaves it for the wallet's tab and closes. This checks the three
 * things only a browser can: that the value crosses from one tab to the other and into the
 * claim, that a claim goes on without it when it never arrives (the link opened elsewhere),
 * and that a server which does not list the return page still signs the person in.
 */
import { chromium, type BrowserContext, type Page, type Route } from 'playwright';

const URL = process.env.E2E_URL || 'http://127.0.0.1:4321';
const STATE = 'c3RhdGUtb2YtYS1zaWduLWluLWZvci10aGlzLXRlc3Qx';
const BINDING = 'Ymlu-ZGluZy1zZW50LXRvLXRoaXMtYnJvd3Nlci1vbmx5';
const fails: string[] = [];
const ok = (c: unknown, m: string) => (c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m)));

interface Server {
  authorizes: Record<string, unknown>[];
  claims: Record<string, unknown>[];
  /** Flipped by the test once "the person opened the link". */
  authorized: boolean;
}

/** Answer the community server's sign-in routes for one browser context. */
async function mockServer(context: BrowserContext, opts: { refuseReturn?: boolean } = {}): Promise<Server> {
  const server: Server = { authorizes: [], claims: [], authorized: false };
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Content-Type': 'application/json',
  };
  const env = (data: unknown, status = 200) => ({ status, headers: cors, body: JSON.stringify(data) });
  await context.route('**/.well-known/stellar.toml*', (route: Route) => route.abort());
  // The provider's page, in the tab the wallet opens: nothing to do there in this suite.
  await context.route('https://auth.example.test/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Authentik</title>' }),
  );
  await context.route('**/v1/wallet/auth/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new globalThis.URL(req.url()).pathname;
    if (path.endsWith('/providers')) {
      return route.fulfill(env({ providers: ['authentik'], sources: [{ id: 'email', name: 'Email' }], email: true }));
    }
    if (path.endsWith('/oauth/authorize')) {
      const body = JSON.parse(req.postData() || '{}') as Record<string, unknown>;
      server.authorizes.push(body);
      if (opts.refuseReturn && body.returnTo) {
        return route.fulfill(
          env({ statusCode: 400, code: 'wallet_return_url_not_allowed', message: 'returnTo is not listed.' }, 400),
        );
      }
      return route.fulfill(
        env(
          { state: STATE, authorizationUrl: 'https://auth.example.test/flow', expiresAt: new Date(Date.now() + 600_000).toISOString() },
          201,
        ),
      );
    }
    if (path.includes('/oauth/session/')) {
      return route.fulfill(env(server.authorized ? { status: 'authorized', bound: true } : { status: 'pending' }));
    }
    if (path.endsWith('/oauth/claim')) {
      server.claims.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill(env({ status: 'verify_email', claimToken: 'c'.repeat(43), expiresInSeconds: 900, email: 'ada@example.com' }));
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  return server;
}

/** Welcome → I have a wallet → my account → "Continuar con email" (Authentik's email source). */
async function startEmailSignIn(page: Page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.getByText('Ya tengo una wallet').click();
  await page.getByText('Con mi cuenta').first().click();
  await page.getByRole('button', { name: 'Continuar con email' }).click();
}

const until = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return cond();
};

const browser = await chromium.launch(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {});
const pageErrors: string[] = [];
try {
  /* ---------- the return page hands the binding to the wallet's tab, and closes ---------- */
  {
    const context = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'es-ES' });
    const server = await mockServer(context);
    const wallet = await context.newPage();
    wallet.on('pageerror', (e) => pageErrors.push(e.message));
    await startEmailSignIn(wallet);
    ok(await until(() => server.authorizes.length === 1, 10_000), 'the sign-in opens a handshake');
    ok(
      server.authorizes[0]?.returnTo === new globalThis.URL('/signed-in/', URL).toString(),
      'the web build asks to come back to its own return page',
    );

    // The person opened the emailed link in this browser: the server marks the handshake and
    // sends the browser to the return page, with the binding in the fragment.
    // A tab opened from the mail is not one a script may close, so the page stays on its line.
    server.authorized = true;
    const landing = await context.newPage();
    landing.on('pageerror', (e) => pageErrors.push(e.message));
    await landing.goto(`${URL}/signed-in/?state=${STATE}#binding=${BINDING}`);
    await landing.getByRole('heading', { name: 'Listo' }).waitFor({ timeout: 10_000 });
    ok(true, 'the return page says it is done');
    ok(landing.url() === new globalThis.URL('/signed-in/', URL).toString(), 'and takes the state and the binding off the address bar');

    ok(await until(() => server.claims.length === 1, 15_000), 'the wallet claims once the server says authorized');
    ok(server.claims[0]?.binding === BINDING, 'the claim carries the binding the other tab received');
    ok(server.claims[0]?.state === STATE && typeof server.claims[0]?.codeVerifier === 'string', 'with the state and the verifier');
    const left = await wallet.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cosmos.signin.binding.')));
    ok(left.length === 0, 'the binding is gone from storage once claimed');

    // The provider's tab the wallet opened (Google, GitHub…) is a script's, and closes itself.
    const popup = wallet.waitForEvent('popup');
    await wallet.evaluate((url) => void window.open(url, '_blank'), `${URL}/signed-in/?state=${STATE}`);
    const opened = await popup;
    ok(await opened.waitForEvent('close', { timeout: 10_000 }).then(() => true, () => false), 'a tab the wallet opened closes itself');
    await context.close();
  }

  /* ------------- no binding ever arrives (the link was opened elsewhere) ------------- */
  {
    const context = await browser.newContext({ viewport: { width: 440, height: 880 }, locale: 'es-ES' });
    const server = await mockServer(context);
    const wallet = await context.newPage();
    wallet.on('pageerror', (e) => pageErrors.push(e.message));
    await startEmailSignIn(wallet);
    await until(() => server.authorizes.length === 1, 10_000);
    server.authorized = true;
    ok(await until(() => server.claims.length === 1, 20_000), 'the claim goes ahead after the wait');
    ok(!('binding' in (server.claims[0] ?? {})), 'without a binding, so the server emails its code');
    await wallet.getByText('ada@example.com', { exact: false }).first().waitFor({ timeout: 10_000 }).catch(() => {});
    await context.close();
  }

  /* ------------- a server that does not list the return page ------------- */
  {
    const context = await browser.newContext({ viewport: { width: 440, height: 880 }, locale: 'es-ES' });
    const server = await mockServer(context, { refuseReturn: true });
    const wallet = await context.newPage();
    wallet.on('pageerror', (e) => pageErrors.push(e.message));
    await startEmailSignIn(wallet);
    ok(await until(() => server.authorizes.length === 2, 10_000), 'a refused return page is asked again without it');
    ok(!('returnTo' in (server.authorizes[1] ?? {})), 'the second request names no return URL');
    await context.close();
  }
} finally {
  await browser.close();
}

ok(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
