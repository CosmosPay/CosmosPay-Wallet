// node:test module loader hook.
//
// The app imports its own modules through the `@/...` alias (tsconfig paths:
// `@/*` -> `src/*`). Node has no idea about that alias, so this hook rewrites
// `@/lib/vault`, `@/constants/fiat`, ... to the real file under src/ before
// Node's resolver sees them. Registered by tests/unit/register.mjs.
//
// Only the pure lib/ + constants/ modules are exercised by the unit tests, so
// no `.tsx` / `.css` resolution is needed here — but the hook tries those
// extensions anyway so it never silently mis-resolves a future test import.
import { existsSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = pathResolve(ROOT, 'src');

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs'];

function resolveFromAlias(specifier) {
  const base = pathResolve(SRC, specifier.slice(2));
  // Exact file (with extension) wins first, then each extension appended, then index files.
  if (existsSync(base) && !base.endsWith('/')) return base;
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of EXTENSIONS) {
    if (existsSync(pathResolve(base, 'index' + ext))) return pathResolve(base, 'index' + ext);
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const file = resolveFromAlias(specifier);
    if (!file) {
      throw new Error(`[test-loader] cannot resolve "@${specifier.slice(1)}" under ${SRC}`);
    }
    return nextResolve(pathToFileURL(file).href, context);
  }
  return nextResolve(specifier, context);
}
