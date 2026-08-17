/**
 * Repo guard: every i18n key must be present in all five languages.
 *
 * The wallet ships Spanish, English, Portuguese, German and French. `makeT`
 * falls back to English then the raw key when a translation is missing, so a
 * forgotten language surfaces as broken copy rather than an error — which is
 * exactly why this guard exists: it fails CI when a key is added to only some
 * languages (or a whole language line is dropped).
 *
 * Run via `npm run check:i18n` (wired into `npm run check:guards`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { T, LANGUAGES, type Lang } from '../src/lib/i18n.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const i18nFile = join(root, 'src/lib/i18n.ts');

const LANGS = LANGUAGES.map((l) => l.code) as Lang[];
const errors: string[] = [];

for (const [key, entry] of Object.entries(T)) {
  for (const lang of LANGS) {
    const v = entry[lang];
    if (typeof v !== 'string' || v.length === 0) {
      errors.push(`i18n key "${key}" is missing or empty for language "${lang}"`);
    }
  }
}

// Duplicate keys in the object literal silently overwrite each other (only the
// last survives), so a copy-paste rename can hide a key. Detect them by parsing
// the source for quoted keys and comparing against the runtime table.
const source = readFileSync(i18nFile, 'utf8');
const seen = new Map<string, number>();
for (const m of source.matchAll(/^\s*'([^']+)':\s*\{/gm)) {
  seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
}
for (const [key, count] of seen) {
  if (count > 1) errors.push(`i18n key "${key}" is defined ${count} times in src/lib/i18n.ts`);
}

if (errors.length) {
  console.error(`✖ i18n guard failed (${errors.length} problem(s)):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ i18n guard passed: ${Object.keys(T).length} keys × ${LANGS.length} languages, no duplicates.`);
