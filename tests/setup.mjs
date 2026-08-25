/**
 * Preload for `npm run test:unit` (`node --import ./tests/setup.mjs`).
 *
 *  1. Registers the `@/…` alias resolver.
 *  2. Provides the browser globals the wallet's pure modules expect. Node 22 already
 *     has crypto.subtle / btoa / atob / TextEncoder / fetch; localStorage it does not,
 *     and `lib/storage.ts` + `lib/endpoints.ts` read it at module scope.
 *  3. Supplies the build-time constants Vite's `define` provides in a real build.
 *  4. Pins the UI language, so the suite means the same thing on every machine.
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

/**
 * PIN THE LANGUAGE. Without this the suite's result depends on the OS locale of whoever
 * runs it.
 *
 * `tNow()` resolves through `savedLang()` -> `localStorage` -> `detectLang()` ->
 * `navigator.language`, and Node fills that in from the machine. A developer on a Spanish
 * Windows box gets `es-AR` and every assertion over a user-facing string passes; CI's Linux
 * runner gets English and four of them fail. That is not hypothetical — it is exactly how
 * `memoProblem` and three `txGuard` row assertions went red on `dev` while the same commit
 * was green on two laptops, and `LANG=en_US` does not reproduce it because Windows takes
 * the locale from the OS rather than the environment.
 *
 * `en` because it is the fallback language and the one every source string is written in,
 * so an assertion message printed by a failing run reads in the same language as the code
 * that produced it.
 *
 * Seeded BEFORE the localStorage stub is installed below is impossible — it is the same
 * object — so it goes after, and it is written through the stub rather than into the Map
 * so a real `localStorage` (if Node ever grows one) is honoured the same way.
 */
const LANG_KEY = 'cosmos.lang';

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

globalThis.localStorage.setItem(LANG_KEY, 'en');
