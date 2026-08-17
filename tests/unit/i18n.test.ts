/**
 * i18n is ~1000 lines of hand-maintained 5-column data with nothing enforcing that
 * the columns stay in step. This is the cheapest guard in the repo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, makeT, T } from '@/lib/i18n';

const CODES = LANGUAGES.map((l) => l.code);

test('every key is translated in every language', () => {
  const missing: string[] = [];
  for (const [key, row] of Object.entries(T)) {
    for (const code of CODES) {
      const value = (row as Record<string, string | undefined>)[code];
      if (!value || !value.trim()) missing.push(`${key}.${code}`);
    }
  }
  assert.deepEqual(missing, [], `missing translations:\n${missing.join('\n')}`);
});

test('a placeholder present in one language is present in all of them', () => {
  const mismatched: string[] = [];
  for (const [key, row] of Object.entries(T)) {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const reference = params((row as Record<string, string>).en ?? '');
    for (const code of CODES) {
      const value = (row as Record<string, string | undefined>)[code] ?? '';
      if (params(value) !== reference) mismatched.push(`${key}.${code}: "${params(value)}" != "${reference}"`);
    }
  }
  assert.deepEqual(mismatched, [], `placeholder mismatch:\n${mismatched.join('\n')}`);
});

test('t() falls back rather than rendering a blank', () => {
  const t = makeT('es');
  assert.equal(t('unlock.unlock'), 'Desbloquear');
  // An unknown key returns the key itself — visible in the UI, never an empty string.
  assert.equal(t('does.not.exist'), 'does.not.exist');
});
