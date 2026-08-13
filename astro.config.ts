import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

// Dev-proxy targets (Node-side only — never shipped to the client). The empty
// prefix makes loadEnv read non-PUBLIC_ vars too, so these stay server-side.
const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
// Developer-Platform (Astro) serves /api/wallet/* — `astro dev` defaults to 4321.
const DEV_PLATFORM_TARGET = env.COSMOS_DEV_PLATFORM_PROXY || 'http://localhost:4321';
// APISIX gateway fronts the payments service (/v1/*) — community-server is on 3000
// behind it, but the wallet must go through the gateway so the API key is validated.
const GATEWAY_TARGET = env.COSMOS_GATEWAY_PROXY || 'http://localhost:9080';

// https://astro.build/config
export default defineConfig({
  // Static output -> produces dist/web/ that Capacitor wraps into the native app.
  output: 'static',
  // Public base path. Defaults to '/' so native (Capacitor) and extension builds
  // keep serving from the root, exactly as before. The GitHub Pages web build runs
  // on a *project subpath* (https://<org>.github.io/<repo>/), so its workflow sets
  // PAGES_BASE=/<repo>/ — Astro then prefixes every generated asset (/assets/*),
  // page route and `import.meta.env.BASE_URL` reference with it, killing the 404s.
  base: process.env.PAGES_BASE || '/',
  // All build artifacts live under dist/ (web here, extensions in dist/extension*,
  // zips in dist/release) so builds never clutter the source root. outDir is dist/web
  // (not dist/) on purpose: `astro build` wipes its own outDir on every run, so keeping
  // the web build in a subfolder lets the extension outputs coexist under dist/ untouched.
  outDir: './dist/web',
  integrations: [react()],
  // Emit bundled JS/CSS into `assets/` instead of the default `_astro/`. MV3
  // browser extensions reject any file/dir whose name starts with `_` (reserved),
  // so the underscore folder made `extension/` fail to load. Renaming it here lets
  // Vite rewrite every internal reference (chunks, dynamic imports, CSS url()) for
  // free; web + native builds are unaffected by the folder name.
  build: { assets: 'assets' },
  // Mobile-first: no trailing-slash surprises inside the WebView.
  trailingSlash: 'ignore',
  // Dev + preview server run on 4500.
  server: { port: 4500 },
  vite: {
    // Dev-only reverse proxy: the browser hits same-origin /api and /v1, Vite
    // forwards them to the local backends server-side — so there's no CORS
    // preflight. Production / native builds bypass this (set PUBLIC_COSMOS_*_URL
    // to absolute URLs; the relative paths below only resolve via this proxy).
    server: {
      proxy: {
        '/api': { target: DEV_PLATFORM_TARGET, changeOrigin: true },
        // The gateway exposes the payments API at /cosmos-api/* (APISIX strips that
        // prefix itself before forwarding upstream), so forward the prefix as-is.
        '/cosmos-api': { target: GATEWAY_TARGET, changeOrigin: true },
      },
      allowedHosts: [env.ALLOWED_HOSTS]
    },
    resolve: {
      // `@` -> src so modules can import `@/lib/...` instead of `../../lib/...`.
      // Existing relative (`../..`) imports keep working — both resolve to the same files.
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [
      // Supply-chain guard. The wallet used to depend on `vite-plugin-node-polyfills`,
      // which dragged in crypto-browserify -> browserify-sign / create-ecdh -> elliptic,
      // an UNPATCHED advisory (GHSA-848j-6mx2-7j84 — no fixed version exists). That
      // plugin is gone: the only Node globals the SDK needs (Buffer / global / process)
      // now come from src/lib/node-globals.ts, loaded from each page's <head>.
      // This still inspects every EMITTED chunk (post tree-shaking) and fails the build
      // if that code ever reappears, so a future dep bump can't silently reintroduce it.
      {
        name: 'cosmos:forbid-elliptic-in-bundle',
        generateBundle(_options, bundle) {
          const leaked: string[] = [];
          for (const [file, chunk] of Object.entries(bundle)) {
            if ((chunk as { type?: string }).type !== 'chunk') continue;
            const mods = (chunk as { modules?: Record<string, unknown> }).modules ?? {};
            for (const id of Object.keys(mods)) {
              if (/[\\/](elliptic|browserify-sign|create-ecdh|crypto-browserify)[\\/]/.test(id)) {
                leaked.push(`${id} -> ${file}`);
              }
            }
          }
          if (leaked.length) {
            throw new Error(
              'Vulnerable elliptic chain reached the client bundle (must stay tree-shaken out):\n  ' + leaked.join('\n  '),
            );
          }
        },
      },
    ],
    build: {
      // A single WebView app: a slightly larger chunk is fine, avoid noisy warnings.
      chunkSizeWarningLimit: 1500,
      // Minify CSS with esbuild, NOT Vite 8's new Lightning CSS default.
      // Lightning CSS rewrites vendor prefixes from its own feature data, and for
      // `backdrop-filter` it deletes the UNPREFIXED declaration and keeps only
      // `-webkit-` — under every target we tried, including `firefox >= 113`.
      // Only WebKit understands the -webkit- alias: Chrome and Firefox both report
      // CSS.supports('-webkit-backdrop-filter', …) === false, so the shipped bundle
      // had the entire glass system silently dead everywhere except Safari.
      // esbuild emits both declarations unchanged, which is correct for all engines.
      cssMinify: 'esbuild',
      // esbuild prunes prefixes against this target, so it has to name the oldest
      // engines we support or it drops ones that are still needed (`-webkit-user-
      // select`, which Safari requires below 17). The floor is what the stylesheets
      // actually demand: color-mix() (Safari 16.2 / Chrome 111 / Firefox 113) and
      // dvh (Safari 15.4).
      cssTarget: ['chrome111', 'edge111', 'firefox113', 'safari16.4', 'ios16.4'],
    },
  },
});
