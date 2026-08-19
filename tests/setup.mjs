/**
 * Preload for `npm run test:unit` (`node --import ./tests/setup.mjs`).
 *
 *  1. Registers the `@/…` alias resolver.
 *  2. Provides the browser globals the wallet's pure modules expect. Node 22 already
 *     has crypto.subtle / btoa / atob / TextEncoder / fetch; localStorage it does not,
 *     and `lib/storage.ts` + `lib/endpoints.ts` read it at module scope.
 *  3. Supplies the build-time constants Vite's `define` provides in a real build.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// import.meta.url is already a file: URL — it is the parent to resolve against.
register('./alias-hook.mjs', import.meta.url);

/**
 * `src/constants/app.ts` reads `__APP_VERSION__` at module scope, and Vite's `define`
 * only exists inside a real build. Reading the same package.json the build reads is
 * what makes the tested value and the shipped value the same value by construction,
 * rather than two strings a test has to compare.
 */
if (typeof globalThis.__APP_VERSION__ === 'undefined') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  globalThis.__APP_VERSION__ = pkg.version;
}

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => void store.set(String(k), String(v)),
    removeItem: (k) => void store.delete(String(k)),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
}
