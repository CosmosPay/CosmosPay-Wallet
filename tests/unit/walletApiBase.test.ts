/**
 * Where the wallet's own sign-in lives (`src/lib/endpoints.ts`, `src/lib/cosmospay.ts`).
 *
 * One place: `/v1/wallet` on the community server, through the gateway. It used to be on
 * the developer platform and then on both behind a flag; the platform now serves no part
 * of it, so what this pins is that no setting — not even pointing the platform somewhere
 * else — sends a sign-in there, and that every call presents the key APISIX needs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetOverrides, setDevMode, setOverride, walletApiBase } from '@/lib/endpoints';
import { signInProviders } from '@/lib/cosmospay';

const hasStorage = typeof localStorage !== 'undefined';

function withDevOverrides(values: Record<string, string>, run: () => void | Promise<void>) {
  setDevMode(true);
  for (const [k, v] of Object.entries(values)) setOverride(k as never, v);
  return Promise.resolve(run()).finally(() => {
    resetOverrides();
    setDevMode(false);
  });
}

test('the sign-in hangs off /v1/wallet on the gateway', () => {
  assert.match(walletApiBase(), /\/v1\/wallet$/);
  assert.doesNotMatch(walletApiBase(), /\/api\/wallet/);
});

test('moving the developer platform does not move the sign-in', { skip: !hasStorage }, () =>
  withDevOverrides(
    { devPlatformUrl: 'https://dev.example.com', gatewayUrl: 'https://gw.example.com', gatewayEntry: '/cosmos-api' },
    () => {
      assert.equal(walletApiBase(), 'https://gw.example.com/cosmos-api/v1/wallet');
    },
  ),
);

/*
 * Behind APISIX key-auth, a call with no key is a 401 from the gateway that never reaches
 * the server. The key goes in `apikey`, because `finish` and the sponsored setup spend
 * `Authorization` on the sign-in's session token.
 */
test('a sign-in call presents the shared key in `apikey`', async () => {
  const real = globalThis.fetch;
  let seen: Record<string, string> = {};
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    seen = (init?.headers ?? {}) as Record<string, string>;
    return new Response(JSON.stringify({ providers: ['authentik'], email: true }), { status: 200 });
  }) as typeof fetch;
  try {
    await signInProviders('pub_key');
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(seen.apikey, 'pub_key');
  assert.equal(seen.Authorization, undefined);
});
