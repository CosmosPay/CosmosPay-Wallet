/**
 * The extension's manifest has to name every backend the bundle was compiled to call.
 *
 * This is the one manifest field that fails silently. A host permission is what exempts
 * an extension-page `fetch` from CORS, and the popup's origin — `chrome-extension://<id>`
 * — can never be allowlisted server-side because the id differs per unpacked install.
 * So a host the bundle calls and the manifest omits is not a warning anywhere: it is a
 * wallet whose swap, KYC and login all fail, reported to the user as the server being
 * unreachable.
 *
 * The rule under test is that both come from the same two variables. Before they did,
 * `.env.example` proposed a production URL outside `*.cosmospay.lat` while the manifest
 * carried that wildcard and nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosmosHostPermissions, hostPattern, safeHost } from '../../scripts/hostPermissions.ts';
import { DEFAULT_DEV_PLATFORM_URL, DEFAULT_GATEWAY_URL } from '../../src/constants/backends.ts';

test('the compiled-in defaults are covered, wildcards included', () => {
  const got = cosmosHostPermissions([DEFAULT_DEV_PLATFORM_URL, DEFAULT_GATEWAY_URL]);
  assert.deepEqual(got, [
    'https://dev.cosmospay.lat/*',
    'https://api.cosmospay.lat/*',
    'https://cosmospay.lat/*',
    'https://*.cosmospay.lat/*',
  ]);
});

test('an env-configured backend reaches the manifest — the bug this replaced', () => {
  // `.env.example` proposes exactly this shape, and `*.cosmospay.lat` does not cover it.
  const got = cosmosHostPermissions(['https://developers.cosmospay.io', 'https://gw.example.net']);
  assert.deepEqual(got, ['https://developers.cosmospay.io/*', 'https://gw.example.net/*']);
});

test('the cosmospay.lat wildcards go once nothing points there', () => {
  // An unused host permission is a line on the install prompt asking for access the
  // build never uses — the opposite of what a wallet should be asking for.
  const got = cosmosHostPermissions(['https://developers.cosmospay.io', 'https://gw.example.net']);
  assert.ok(!got.some((p) => p.includes('cosmospay.lat')));
});

test('one host named twice is one permission', () => {
  const got = cosmosHostPermissions(['https://one.example.com', 'https://one.example.com']);
  assert.deepEqual(got, ['https://one.example.com/*']);
});

test('a port is part of the pattern, a path is not', () => {
  assert.equal(hostPattern('https://gw.example.net:8443/cosmos-api'), 'https://gw.example.net:8443/*');
  assert.equal(hostPattern('https://gw.example.net/cosmos-api/v1'), 'https://gw.example.net/*');
});

test('the same-origin dev default names no host and asks for no permission', () => {
  // '' is what `.env` holds in development, where the Vite proxy answers same-origin and
  // there is no extension in play at all. It must not become a bogus pattern.
  assert.equal(hostPattern(''), null);
  assert.equal(safeHost(''), '');
  assert.deepEqual(cosmosHostPermissions(['', '']), []);
});

test('only http(s) becomes a permission', () => {
  // A manifest cannot grant these, and MV3 rejects the whole file over one bad pattern —
  // so a mistyped value must drop out here rather than produce an extension that will
  // not load at all.
  assert.equal(hostPattern('tauri://localhost'), null);
  assert.equal(hostPattern('chrome-extension://abcdef'), null);
  assert.equal(hostPattern('not a url'), null);
});

test('a lookalike domain does not earn the cosmospay.lat wildcards', () => {
  // `notcosmospay.lat` and `cosmospay.lat.evil.com` both contain the string; neither is
  // the domain, and a substring check would have handed both the wildcard.
  for (const host of ['https://notcosmospay.lat', 'https://cosmospay.lat.evil.com']) {
    const got = cosmosHostPermissions([host]);
    assert.ok(!got.some((p) => p.includes('*.cosmospay.lat')), host);
  }
});
