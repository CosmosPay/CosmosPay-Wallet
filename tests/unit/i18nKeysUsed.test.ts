/**
 * Every i18n key the code asks for exists.
 *
 * `tests/unit/i18n.test.ts` checks that each key in the table is filled in all five
 * languages. It cannot see the opposite failure: a key the code USES that the table does not
 * have. `t()` answers that with the key itself, so the screen shows `signin.codeTitle` where
 * a sentence should be — and nothing fails, in any language, anywhere.
 *
 * This reads every `t(…)` / `tNow(…)` call in src/ and checks the string literals in its
 * FIRST argument, which catches the plain call and the `t(cond ? 'a' : 'b')` form alike.
 * A key built from a template (`signin.error.${reason}`) is out of its reach by design;
 * those modules export the function that builds it, and their own tests pin the mapping.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { T } from '@/lib/i18n';

const SRC = join(import.meta.dirname, '..', '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

/** The first argument of every `t(` / `tNow(` call: up to the first `,` or `)` at depth 0. */
function firstArgs(source: string): string[] {
  const out: string[] = [];
  const call = /\b(?:t|tNow)\(/g;
  for (let m = call.exec(source); m; m = call.exec(source)) {
    let depth = 0;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) break;
    }
    out.push(source.slice(start, i));
  }
  return out;
}

const KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+$/;

test('every literal i18n key used in src/ is in the table', () => {
  const missing: string[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const arg of firstArgs(text)) {
      if (arg.includes('`')) continue; // built from a template — see the header
      for (const lit of arg.match(/'([^'\\]+)'/g) ?? []) {
        const key = lit.slice(1, -1);
        if (KEY.test(key) && !(key in T)) missing.push(`${relative(SRC, file).replaceAll('\\', '/')}: ${key}`);
      }
    }
  }
  assert.deepEqual(missing, [], `keys used but missing from the table:\n  ${missing.join('\n  ')}`);
});
