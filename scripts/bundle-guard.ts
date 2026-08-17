/**
 * Supply-chain guard for the client bundle.
 *
 * The `elliptic` chain (crypto-browserify -> browserify-sign / create-ecdh ->
 * elliptic) carries an UNPATCHED advisory (GHSA-848j-6mx2-7j84) and used to be
 * pulled in transitively by vite-plugin-node-polyfills. The wallet is ed25519 +
 * Web Crypto, so it's tree-shaken out today. This inspects every EMITTED chunk
 * (post tree-shaking) and fails the build if that code ever survives into the
 * shipped bundle — so a known-vulnerable dep can never reach users, even if a
 * future import or an `npm audit fix --force` reshuffles the tree.
 */

export const FORBIDDEN_CHAIN = [
  'elliptic',
  'browserify-sign',
  'create-ecdh',
  'crypto-browserify',
] as const;

/** Find modules under any forbidden package that leaked into emitted chunks. */
export function findLeakedChain(bundle: Record<string, unknown>): string[] {
  const leaked: string[] = [];
  for (const [file, chunk] of Object.entries(bundle)) {
    if ((chunk as { type?: string }).type !== 'chunk') continue;
    const mods = (chunk as { modules?: Record<string, unknown> }).modules ?? {};
    for (const id of Object.keys(mods)) {
      if (FORBIDDEN_CHAIN.some((pkg) => new RegExp(`[\\\\/]${pkg}[\\\\/]`).test(id))) {
        leaked.push(`${id} -> ${file}`);
      }
    }
  }
  return leaked;
}

/**
 * Rollup `generateBundle` hook that fails the build if the vulnerable chain
 * survives tree-shaking into any emitted chunk. Throwing here aborts the build
 * with a clear, actionable message instead of silently shipping the code.
 */
export function vetoVulnerableChain() {
  return {
    name: 'cosmos:forbid-elliptic-in-bundle',
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      const leaked = findLeakedChain(bundle);
      if (leaked.length) {
        throw new Error(
          'Vulnerable elliptic chain reached the client bundle (must stay tree-shaken out):\n  ' +
            leaked.join('\n  '),
        );
      }
    },
  };
}
