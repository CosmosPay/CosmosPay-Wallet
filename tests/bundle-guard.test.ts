/**
 * Unit test for the supply-chain bundle guard (scripts/bundle-guard.ts).
 *
 *   npm run test:unit
 *
 * The guard inspects every EMITTED chunk (post tree-shaking) and fails the build
 * if the UNPATCHED `elliptic` chain (crypto-browserify -> browserify-sign /
 * create-ecdh -> elliptic, GHSA-848j-6mx2-7j84) ever survives into the shipped
 * bundle. It must flag each forbidden package and pass clean bundles.
 */
import { strict as assert } from 'node:assert';
import { FORBIDDEN_CHAIN, findLeakedChain, vetoVulnerableChain } from '../scripts/bundle-guard.ts';

const fails: string[] = [];
const ok = (c: unknown, m: string) =>
  c ? console.log('✓ ' + m) : (fails.push(m), console.log('✗ ' + m));

try {
  // 1) A clean bundle (no forbidden modules) must not be flagged.
  const clean = {
    'assets/app.js': {
      type: 'chunk',
      modules: {
        '/repo/src/main.ts': {},
        '/repo/node_modules/@stellar/stellar-sdk/dist/stellar-sdk.js': {},
        '/repo/node_modules/buffer/index.js': {},
      },
    },
    'assets/app.css': { type: 'asset' },
  };
  assert.deepEqual(findLeakedChain(clean), []);
  ok(true, 'clean bundle (stellar-sdk + buffer) is not flagged');

  // 2) Every forbidden package must be detected in an emitted chunk.
  for (const pkg of FORBIDDEN_CHAIN) {
    const leaked = findLeakedChain({
      'assets/app.js': {
        type: 'chunk',
        modules: { [`/repo/node_modules/${pkg}/lib/index.js`]: {} },
      },
    });
    ok(leaked.length === 1 && leaked[0].includes(pkg), `${pkg} flagged in emitted chunk`);
  }

  // 3) The veto hook throws a clear, actionable error when the chain leaks.
  const plugin = vetoVulnerableChain();
  assert.throws(
    () =>
      plugin.generateBundle({}, {
        'assets/app.js': {
          type: 'chunk',
          modules: { '/repo/node_modules/elliptic/lib/elliptic.js': {} },
        },
      }),
    /Vulnerable elliptic chain reached the client bundle/,
  );
  ok(true, 'veto throws on a leaked elliptic module');

  // 4) The veto hook lets a clean bundle through.
  assert.doesNotThrow(() => plugin.generateBundle({}, clean));
  ok(true, 'veto passes a clean bundle');
} catch (e) {
  fails.push('exception: ' + (e as Error).message);
  console.log('✗ exception:', (e as Error).message);
}

console.log(fails.length ? `\nFAILED (${fails.length})` : '\nALL PASSED');
process.exit(fails.length ? 1 : 0);
