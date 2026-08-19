/**
 * Ambient declarations for build-time constants.
 *
 * `__APP_VERSION__` is substituted by Vite's `define` (see `vite.define` in
 * astro.config.ts) with the version from package.json. It is a bare global rather than
 * an import for two reasons: package.json lives outside `src/`, where the `@/` alias
 * cannot reach, and `src/constants/app.ts` may not take runtime imports at all.
 *
 * It is read in exactly one place — `APP_VERSION` in src/constants/app.ts. Read it
 * there, not here: a second reader is a second copy, which is the problem this
 * replaced. tests/setup.mjs defines the same global from the same package.json, which
 * is what keeps `@/constants/app` importable from node:test.
 */
declare const __APP_VERSION__: string;
