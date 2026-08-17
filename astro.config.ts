import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
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
    },
    resolve: {
      // `@` -> src so modules can import `@/lib/...` instead of `../../lib/...`.
      // Existing relative (`../..`) imports keep working — both resolve to the same files.
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [
      // The Stellar SDK + bip39 expect Node's Buffer / global / process.
      // protocolImports:false avoids hijacking Vite's own `node:` imports.
      nodePolyfills({
        globals: { Buffer: true, global: true, process: true },
        protocolImports: false,
      }),
      // Supply-chain guard: the `elliptic` chain (crypto-browserify -> browserify-sign
      // / create-ecdh -> elliptic) carries an UNPATCHED advisory (GHSA-848j-6mx2-7j84)
      // and is pulled in transitively by vite-plugin-node-polyfills. The wallet is
      // ed25519 + Web Crypto, so it's tree-shaken out today. This inspects every EMITTED
      // chunk (post tree-shaking) and fails the build if that code ever survives into the
      // shipped bundle — so a known-vulnerable dep can never reach users, even if a
      // future import or an `npm audit fix --force` reshuffles the tree.
      {
        name: 'cosmos:forbid-elliptic-in-bundle',
        generateBundle(_options, bundle) {
          const leaked: string[] = [];
          for (const [file, chunk] of Object.entries(bundle)) {
            if ((chunk as { type?: string }).type !== 'chunk') continue;
            const mods = (chunk as { modules?: Record<string, unknown> }).modules ?? {};
            for (const id of Object.keys(mods)) {
              if (/[\\/](elliptic|browserify-sign|create-ecdh)[\\/]/.test(id)) leaked.push(`${id} -> ${file}`);
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
      // Pin the CSS minifier explicitly — DO NOT let it fall back to the Vite
      // default. Astro 7 ships Vite 8, whose default CSS minifier is Lightning
      // CSS, and Lightning rewrites vendor prefixes from its own feature data:
      // for `backdrop-filter` it DELETES the unprefixed declaration and keeps
      // only `-webkit-backdrop-filter`. Chrome and Firefox both report
      // CSS.supports('-webkit-backdrop-filter', …) === false, so a shipped
      // bundle loses the entire glass system (.glass, .glass-soft, .glass-bright,
      // .input, .btn-primary, dropdowns treated as `backdrop-filter: none`)
      // for everyone except Safari — while astro dev (unminified) looks perfect.
      // esbuild only minifies and never adds/removes/reorders vendor prefixes,
      // so the hand-written `-webkit-` + unprefixed pairs in src/styles survive
      // the build verbatim. If you ever "simplify" this back to 'lightningcss',
      // the per-browser rendering regression above comes straight back — no
      // test in this repo catches it (the responsive suite checks layout, not
      // appearance). This comment exists to protect the next person to do that.
      cssMinify: 'esbuild',
      // Pin the CSS lower browser floor to what the stylesheets already demand:
      // color-mix() needs Chrome/Edge 111, Firefox 113, Safari 16.2, and dvh
      // (~Chrome 108 / Firefox 101 / Safari 15.4) is below that. Explicitly
      // pinning the cssTarget stops it silently drifting to whatever "modern
      // browsers" Vite happens to mean in a future major.
      cssTarget: ['chrome111', 'edge111', 'firefox113', 'safari16.2'],
      // A single WebView app: a slightly larger chunk is fine, avoid noisy warnings.
      chunkSizeWarningLimit: 1500,
    },
  },
});
