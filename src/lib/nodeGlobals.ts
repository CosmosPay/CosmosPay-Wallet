/**
 * Node globals shim for the browser.
 *
 * Replaces `vite-plugin-node-polyfills`, which dragged in the crypto-browserify ->
 * browserify-sign / create-ecdh -> elliptic chain (GHSA-848j-6mx2-7j84, with NO patched
 * version). Only the three globals the libraries actually need are installed here, with
 * `Buffer` coming from the `buffer` package (deps: base64-js + ieee754, both dependency-free
 * and advisory-free).
 *
 * Who really uses them:
 *   - Buffer  -> @stellar/js-xdr, bip39, and the wallet's own code.
 *   - global  -> @stellar/js-xdr (`global.Array` in src/array.js).
 *   - process -> only defensive reads (`typeof process !== 'undefined'`), but a minimal
 *                stub avoids surprises if some dependency assumes it exists.
 *
 * IMPORTANT: this module must be evaluated BEFORE any React island. Each page imports it
 * from a page script, which Astro hoists into the document head — modules run in document
 * order, so this lands before island hydration.
 */
import { Buffer } from 'buffer';

// `globalThis` already declares `process` with Node's types (via a transitive @types/node),
// so go through an index signature: all that's needed here is a browser stub, not a Process.
const g = globalThis as unknown as Record<string, unknown>;

g.Buffer ??= Buffer;
g.global ??= globalThis;
g.process ??= {
  env: {},
  browser: true,
  nextTick: (fn: () => void) => queueMicrotask(fn),
};

export {};
