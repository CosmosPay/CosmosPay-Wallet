import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { loadEnv, type ProxyOptions } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { devIconsIntegration, iconFlavor } from './scripts/devIcons.ts';

/**
 * The version the app SHOWS is the version the app IS.
 *
 * package.json is the single source of truth — scripts/build-extension.ts already reads
 * it for the MV3 manifest, and src/constants/app.ts used to duplicate it as a
 * hand-edited literal. That literal drifted two releases behind once already, and the
 * test written to pin them could not catch the drift it was written for: the release
 * bot bumps package.json in a job that runs AFTER the suite, so the tested tree is
 * always the pre-bump one. Injecting the value deletes the second copy instead of
 * guarding it, and it picks up the `-dev.<run_number>` prerelease suffix — a value no
 * committed literal can hold, because it does not exist until the run number does.
 *
 * Read here rather than imported by src/constants/app.ts because package.json sits
 * outside src/, where the `@/` alias cannot reach, and because `constants/` may not
 * take runtime imports (see CLAUDE.md). tests/setup.mjs sets the same global from the
 * same file, which is what keeps `@/constants/app` importable from node:test.
 */
const APP_VERSION = (
  JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as {
    version: string;
  }
).version;

// Dev-proxy targets (Node-side only — never shipped to the client). The empty
// prefix makes loadEnv read non-PUBLIC_ vars too, so these stay server-side.
const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
// Developer-Platform (Astro) serves /api/wallet/* — `astro dev` defaults to 4321.
const DEV_PLATFORM_TARGET = env.COSMOS_DEV_PLATFORM_PROXY || 'http://localhost:4321';
// APISIX gateway fronts the payments service (/v1/*) — community-server is on 3000
// behind it, but the wallet must go through the gateway so the API key is validated.
const GATEWAY_TARGET = env.COSMOS_GATEWAY_PROXY || 'http://localhost:9080';

/**
 * Connection-class failures: the backend is not answering at all, as opposed to
 * answering badly. Node's happy-eyeballs connect path (`autoSelectFamily`, on by
 * default) tries every address a host resolves to and wraps the results in an
 * `AggregateError` that carries NO `code` of its own — the causes are in `.errors`.
 * Reading only the outer `code` is why such a failure reads as an unknown error.
 */
const OFFLINE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

function isOffline(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; errors?: unknown };
  if (typeof e.code === 'string' && OFFLINE_CODES.has(e.code)) return true;
  return Array.isArray(e.errors) && e.errors.some(isOffline);
}

/**
 * Proxy options for one dev backend.
 *
 * `configure` is here because of what this failure looks like without it. A backend
 * that is simply not running produces `AggregateError [ECONNREFUSED]` and a stack
 * through `internalConnectMultiple` — which names Node's socket internals and not the
 * three things the reader actually needs: WHICH backend, at WHICH address, set by
 * WHICH variable. Vite logs that stack before it checks whether anyone handled the
 * error, so this ADDS the line that explains it; it does not replace it.
 *
 * It also answers 503 with a JSON body instead of Vite's bare 502 text/plain, because
 * the wallet reads one: `apiError` (src/lib/apiError.ts) builds the user-visible line
 * from `.message`, so a down backend says so in the app during dev rather than
 * surfacing as a generic "request failed". The one caller that ignores the body —
 * `warmPublicKey`, which reads nothing but `res.ok` — falls back to the compiled-in
 * public key exactly as it should when a backend is unreachable.
 */
function devProxy(name: string, target: string, envVar: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('error', (err: unknown, _req: unknown, res: unknown) => {
        // The ws path hands a Socket here, which has no response to write.
        if (!isOffline(err) || !res || typeof res !== 'object' || !('writeHead' in res)) return;
        console.error(`
  [dev proxy] ${name} is not answering at ${target}.
  Start it, or point ${envVar} at a host that is.
`);
        const r = res as {
          headersSent: boolean;
          writableEnded: boolean;
          writeHead: (code: number, headers: Record<string, string>) => void;
          end: (body?: string) => void;
        };
        if (r.headersSent || r.writableEnded) return;
        r.writeHead(503, { 'Content-Type': 'application/json' });
        r.end(JSON.stringify({ message: `${name} is not reachable at ${target} (Vite dev proxy)` }));
      });
    },
  };
}

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
  // A build that did not come out of CI wears the amber dev icon — favicon and the
  // extension's icon set, both tinted in dist/web — so a local tab or unpacked extension
  // cannot pass for the released one. The rule and its override are in scripts/devIcons.ts.
  integrations: [react(), ...(iconFlavor() === 'dev' ? [devIconsIntegration()] : [])],
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
    // Build-time constants. `__APP_VERSION__` is declared ambiently in src/env.d.ts and
    // consumed by src/constants/app.ts — see the comment on APP_VERSION above.
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    /**
     * Pre-bundle the dependencies the dev optimizer would otherwise find LATE.
     *
     * Vite's first optimize pass only sees what the entry reaches statically. Everything
     * below is behind a `lazy()` screen or a dynamic `import()`, so it was discovered the
     * moment a screen first ran — which re-runs the optimizer, bumps the `?v=` hash on
     * every pre-bundled dep, and makes the URLs the loaded page is already holding answer
     * `504 (Outdated Optimize Dep)`. React `lazy()` reports that rejection as "Failed to
     * fetch dynamically imported module", naming the screen rather than the dep, so the
     * onboarding screens looked broken while the actual stale imports were
     * `@tauri-apps/api/core` (lib/nativeBridge.ts) and `@tauri-apps/plugin-store`
     * (lib/storage.ts) — neither of which those screens mention.
     *
     * Listing them puts them in the FIRST pass, so the hash never moves. This is a dev
     * concern only: the production build bundles from the real module graph and never
     * consults this list. A dynamic import added over a package NOT listed here brings the
     * reload back, which is why the list names the reason rather than just the packages.
     */
    optimizeDeps: {
      include: [
        // Absent outside a Tauri WebView — `lib/platform.ts` gates each of these, so on
        // web and in the extension they are imported and then never used.
        '@tauri-apps/api/core',
        '@tauri-apps/plugin-store',
        '@tauri-apps/plugin-clipboard-manager',
        '@tauri-apps/plugin-opener',
        // Static imports, but only inside a lazily-loaded module: jsqr in the `scan`
        // screen, bip39 behind `import('@/lib/wallet')` in the store.
        'jsqr',
        'bip39',
      ],
    },
    // Dev-only reverse proxy: the browser hits same-origin /api and /v1, Vite
    // forwards them to the local backends server-side — so there's no CORS
    // preflight. Production / native builds bypass this (set PUBLIC_COSMOS_*_URL
    // to absolute URLs; the relative paths below only resolve via this proxy).
    server: {
      proxy: {
        '/api': devProxy('cosmos dev-platform', DEV_PLATFORM_TARGET, 'COSMOS_DEV_PLATFORM_PROXY'),
        // The gateway exposes the payments API at /cosmos-api/* (APISIX strips that
        // prefix itself before forwarding upstream), so forward the prefix as-is.
        '/cosmos-api': devProxy('cosmos gateway (APISIX)', GATEWAY_TARGET, 'COSMOS_GATEWAY_PROXY'),
      },
      // Comma-separated, and FILTERED: `[env.ALLOWED_HOSTS]` put a literal `undefined`
      // (or an empty string) in the list whenever the var was unset, which Vite reads as
      // a host named "" — never matching, and masking the real "Blocked request" cause.
      allowedHosts: (env.ALLOWED_HOSTS ?? '')
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
      // The native projects are generated inside the repo, and `cap sync` copies the
      // whole of dist/web/ into android/app/src/main/assets/public/ — under the project
      // root, so the dev-server watcher treats every copied file as a source edit and
      // reloads. During `npm run dev:android` that fires on each sync, for files the app
      // never loads in live-reload mode. Vite appends this to its own ignore defaults.
      watch: { ignored: ['**/android/**', '**/ios/**'] },
    },
    resolve: {
      // `@` -> src. This is the ONLY import form allowed inside src/ (see CLAUDE.md):
      // relative paths broke silently on file moves and read differently per depth.
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
