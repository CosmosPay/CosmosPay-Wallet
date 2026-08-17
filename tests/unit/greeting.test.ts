import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageFromBirthdate } from '@/lib/greeting';

test('ageFromBirthdate computes full years', () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  // born exactly 18 years ago today -> 18
  assert.equal(ageFromBirthdate(`${y - 18}-${m}-${d}`), 18);
  // born 18 years ago tomorrow -> 17
  const tomorrow = new Date(now.getTime() + 86400000);
  const tm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const td = String(tomorrow.getDate()).padStart(2, '0');
  assert.equal(ageFromBirthdate(`${y - 18}-${tm}-${td}`), 17);
});

test('ageFromBirthdate returns null for missing/invalid dates', () => {
  assert.equal(ageFromBirthdate(''), null);
  assert.equal(ageFromBirthdate('not-a-date'), null);
});

test('fiat 18+ gate relies on the same helper', () => {
  const now = new Date();
  const y = now.getFullYear();
  assert.equal((ageFromBirthdate(`${y - 18}-01-01`) ?? 0) >= 18, true);
  assert.equal((ageFromBirthdate(`${y - 12}-01-01`) ?? 0) >= 18, false);
});
