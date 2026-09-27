/**
 * Refresh `openapi/community-server.json` — the wallet's copy of the community server's
 * contract, which `tests/unit/gatewayContract.test.ts` holds every gateway call against.
 *
 * Verbatim, no transform. Source, first match wins:
 *   1. `OPENAPI_SRC` — a file path or an http(s) URL
 *   2. `../comos-pay-community-server/openapi/openapi.json` — the sibling checkout
 *
 *   npm run openapi:sync           # write it
 *   npm run openapi:check          # exit 1 when stale; skipped when no source is reachable
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const OUT = path.join(root, 'openapi', 'community-server.json');
const SIBLING = path.resolve(root, '..', 'comos-pay-community-server', 'openapi', 'openapi.json');

async function readSource(): Promise<string | null> {
  const src = process.env.OPENAPI_SRC;
  if (src && /^https?:\/\//i.test(src)) {
    const res = await fetch(src, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${src} answered ${res.status}`);
    return res.text();
  }
  const file = src ? path.resolve(src) : SIBLING;
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Parsed and re-serialized, so line endings and spacing never count as drift. */
const canonical = (text: string): string => `${JSON.stringify(JSON.parse(text), null, 2)}\n`;

const source = await readSource();
if (source === null) {
  console.warn('[openapi] no community-server spec reachable (set OPENAPI_SRC) — nothing to compare.');
  process.exit(0);
}
const next = canonical(source);
if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? canonical(readFileSync(OUT, 'utf8')) : '';
  if (current !== next) {
    console.error('[openapi] openapi/community-server.json is stale — run `npm run openapi:sync`.');
    process.exit(1);
  }
  console.log('[openapi] openapi/community-server.json matches the server.');
} else {
  writeFileSync(OUT, next);
  console.log(`[openapi] wrote ${path.relative(root, OUT)}`);
}
