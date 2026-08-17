/**
 * First-party Node-compat shim for browser targets.
 *
 * The wallet runs on Web Crypto + ed25519, but a few direct dependencies
 * (@stellar/stellar-sdk, bip39) still reference Node globals at runtime:
 *   - `Buffer`  — byte buffers for SEP-5 derivation, signing, base64 payloads
 *   - `global`  — Node-style alias some bundled deps expect for the global object
 *   - `process` — minimal surface (env + nextTick)
 *
 * This replaces the old `vite-plugin-node-polyfills`, which dragged the
 * UNPATCHED `elliptic` chain (crypto-browserify -> browserify-sign/create-ecdh
 * -> elliptic, GHSA-848j-6mx2-7j84) into the dependency tree. Here we reuse the
 * direct, patched `buffer` dependency (@stellar/stellar-sdk already ships it)
 * and polyfill the other two globals with a few lines of first-party code.
 *
 * Imported from the <head> of every Astro document (main app + approval window)
 * so the globals exist before any React island/root mounts.
 */
import { Buffer } from 'buffer';

const g = globalThis as unknown as Record<string, unknown>;

// Buffer — used by @stellar/stellar-sdk (Keypair, xdr) and bip39 at runtime.
if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer;
}

// `global` — Node-style alias some bundled deps expect for the global object.
if (typeof g.global === 'undefined') {
  g.global = g;
}

// `process` — minimal surface. Deliberately NO `versions.node`: axios's
// fetch-client reads it to pick the Node adapter, and the wallet must stay on
// the browser fetch path.
if (typeof g.process === 'undefined') {
  g.process = {
    env: {},
    nextTick: (cb: (...args: unknown[]) => void, ...args: unknown[]) => {
      queueMicrotask(() => cb(...args));
    },
  };
}

export {};
