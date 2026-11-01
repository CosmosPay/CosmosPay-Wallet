/**
 * The Welcome screen's greeting (src/lib/greeting.ts): it varies, but only within what fits
 * the hour, and it never greets a first visit as a return.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '@/lib/i18n';
import { welcomeGreeting, welcomeGreetings } from '@/lib/greeting';

const t = makeT('es');
const at = (hour: number) => new Date(2026, 9, 28, hour, 30);

test('the welcome greeting comes from the pool for its hour', () => {
  for (const hour of [3, 8, 15, 22]) {
    const pool = welcomeGreetings(t, hour);
    for (const r of [0, 0.3, 0.6, 0.99]) assert.ok(pool.includes(welcomeGreeting(t, at(hour), () => r)), `${hour}h ${r}`);
  }
});

test('it varies: every line of the pool can come up', () => {
  const pool = welcomeGreetings(t, 8);
  const seen = new Set(pool.map((_, i) => welcomeGreeting(t, at(8), () => (i + 0.5) / pool.length)));
  assert.equal(seen.size, pool.length);
});

test('the hour decides the time-of-day lines', () => {
  assert.ok(welcomeGreetings(t, 8).includes(t('greet.morning')));
  assert.ok(welcomeGreetings(t, 15).includes(t('greet.afternoon')));
  assert.ok(welcomeGreetings(t, 22).includes(t('greet.evening')));
  assert.ok(welcomeGreetings(t, 3).includes(t('greet.evening')));
  assert.ok(!welcomeGreetings(t, 8).includes(t('greet.evening')));
});

test('a first visit is never welcomed back, and never by name', () => {
  for (const hour of [3, 8, 15, 22]) {
    for (const line of welcomeGreetings(t, hour)) {
      assert.ok(!line.includes('de nuevo') && !line.includes('extrañábamos'), line);
      assert.ok(!line.includes('{name}'), line);
    }
  }
});
