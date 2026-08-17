/**
 * Unit test for the first-party Node-compat shim (src/lib/node-shim.ts).
 *
 *   npm run test:unit
 *
 * The shim must install Buffer / global / process onto globalThis (the wallet's
 * direct deps — @stellar/stellar-sdk, bip39 — reference them at runtime). It is
 * exercised here in a bare-browser-like scope: the Node globals are deleted
 * first, the shim is imported fresh, and we assert the globals appear and work.
 * The original globals are restored afterwards so the process is left untouched.
 */
const g = globalThis as Record<string, unknown>;
const saved = {
  Buffer: g.Buffer,
  global: g.global,
  process: g.process,
};

// Simulate a bare browser global scope: none of the Node globals exist yet.
delete g.Buffer;
delete g.global;
delete g.process;

const fails: string[] = [];
const ok = (c: unknown, m: string) =>
  c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m));

try {
  // Fresh (cache-busted) import so the shim actually runs its setup.
  await import(`../src/lib/node-shim.ts?test=${Date.now()}`);

  ok(typeof g.Buffer === 'function', 'Buffer installed on globalThis');
  ok(g.global === g, 'global aliases globalThis');
  ok(g.process !== null && typeof g.process === 'object', 'process installed on globalThis');

  const env = (g.process as { env: unknown }).env;
  ok(env !== null && typeof env === 'object', 'process.env is an object');

  // Buffer.from round-trips — this is the wallet's main use
  // (Buffer.from(message, 'utf8').toString('base64')).
  const b64 = (g.Buffer as typeof Buffer).from('hola', 'utf8').toString('base64');
  ok(b64 === 'aG9sYQ==', 'Buffer.from(...).toString(base64) round-trips');

  // process.nextTick schedules a callback asynchronously.
  let ticked = false;
  (g.process as { nextTick: (cb: () => void) => void }).nextTick(() => {
    ticked = true;
  });
  await new Promise((r) => setTimeout(r, 0));
  ok(ticked, 'process.nextTick schedules a callback');

  // Idempotent: importing again must not clobber the installed globals.
  const installedBuffer = g.Buffer;
  await import(`../src/lib/node-shim.ts?test=${Date.now()}`);
  ok(g.Buffer === installedBuffer, 'shim is idempotent (no clobbering on re-run)');
} catch (e) {
  fails.push('exception: ' + (e as Error).message);
  console.log('✗ exception:', (e as Error).message);
} finally {
  // Restore the original globals so this process is left as we found it.
  if (saved.Buffer !== undefined) g.Buffer = saved.Buffer;
  else delete g.Buffer;
  if (saved.global !== undefined) g.global = saved.global;
  else delete g.global;
  if (saved.process !== undefined) g.process = saved.process;
  else delete g.process;
}

console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);

// Marks this file as a module so top-level `await` (used above) is allowed.
export {};
