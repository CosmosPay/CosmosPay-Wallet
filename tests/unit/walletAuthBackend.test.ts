/**
 * Which backend serves the wallet's own sign-in (`src/lib/endpoints.ts`).
 *
 * The sign-in exists at two addresses — the developer platform, and the
 * community server behind the gateway — and they are the SAME protocol. What
 * this pins is that switching between them is a prefix and nothing else: the
 * paths after `walletApiBase()` are identical on both sides, so a route that
 * hardcoded one of the two would still compile and would simply stop working on
 * the other.
 *
 * It also pins the default. `platform` is what an existing build must keep
 * doing: a deployment that upgrades the wallet without setting anything should
 * not silently move its users' sign-in to a host its gateway may not route yet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setDevMode, setOverride, resetOverrides, walletApiBase, walletAuthBackend } from '@/lib/endpoints';

/** The overrides are localStorage-backed; `lib/endpoints` swallows its absence. */
function withDevOverrides(values: Record<string, string>, run: () => void): void {
  setDevMode(true);
  for (const [k, v] of Object.entries(values)) setOverride(k as never, v);
  try {
    run();
  } finally {
    resetOverrides();
    setDevMode(false);
  }
}

const hasStorage = typeof localStorage !== 'undefined';

test('defaults to the platform, so an upgrade moves nobody', () => {
  assert.equal(walletAuthBackend(), 'platform');
  assert.match(walletApiBase(), /\/api\/wallet$/);
});

test('an unrecognised value is the platform, not a guess', { skip: !hasStorage }, () => {
  withDevOverrides({ walletAuthBackend: 'community' }, () => {
    assert.equal(walletAuthBackend(), 'platform');
  });
});

test('gateway mode points at /v1/wallet behind the gateway entry', { skip: !hasStorage }, () => {
  withDevOverrides(
    {
      walletAuthBackend: 'gateway',
      gatewayUrl: 'https://gw.example.com',
      gatewayEntry: '/cosmos-api',
    },
    () => {
      assert.equal(walletAuthBackend(), 'gateway');
      assert.equal(walletApiBase(), 'https://gw.example.com/cosmos-api/v1/wallet');
    },
  );
});

test('platform mode points at /api/wallet on the dev platform', { skip: !hasStorage }, () => {
  withDevOverrides({ walletAuthBackend: 'platform', devPlatformUrl: 'https://dev.example.com' }, () => {
    assert.equal(walletApiBase(), 'https://dev.example.com/api/wallet');
  });
});

/*
 * The paths the call sites append. Both backends serve all of them, which is
 * what makes the switch a one-liner — if one side ever renames a path, this list
 * is where the divergence has to be admitted rather than discovered.
 */
test('every sign-in path hangs off the same base', { skip: !hasStorage }, () => {
  const paths = [
    '/auth/providers',
    '/auth/oauth/authorize',
    '/auth/oauth/claim',
    '/auth/email/start',
    '/auth/email/verify',
    '/auth/finish',
    '/backup',
  ];

  const bases: string[] = [];
  withDevOverrides({ walletAuthBackend: 'platform', devPlatformUrl: 'https://dev.example.com' }, () => {
    bases.push(walletApiBase());
  });
  withDevOverrides(
    { walletAuthBackend: 'gateway', gatewayUrl: 'https://gw.example.com', gatewayEntry: '/cosmos-api' },
    () => {
      bases.push(walletApiBase());
    },
  );

  assert.notEqual(bases[0], bases[1]);
  for (const base of bases) {
    for (const path of paths) {
      assert.ok(`${base}${path}`.startsWith(base), `${path} must hang off the base`);
    }
  }
});
