/**
 * The greetings (src/lib/greeting.ts). Welcome's varies, but only within what fits the hour,
 * and it never greets a first visit as a return. Unlock's and Home's carry the name, and the
 * name sits inside the sentence in every language: never after a closing "!" or "?".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T, makeT } from '@/lib/i18n';
import { LANG_CODES } from '@/constants/i18n';
import { getGreeting, returnGreetingKeys, welcomeGreeting, welcomeGreetings } from '@/lib/greeting';
import type { Gender } from '@/lib/vault';

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

/* ------------------------------ with the name ------------------------------ */

const GENDERS: Gender[] = ['m', 'f', 'x'];
const HOURS = [3, 8, 15, 22];

test('every line that carries the name has its own translation, with the name in it', () => {
  for (const hour of HOURS) {
    for (const g of GENDERS) {
      for (const key of returnGreetingKeys(hour, g)) {
        assert.ok(T[key], key);
        assert.ok(T[`${key}.named`], `${key}.named`);
        for (const lang of LANG_CODES) assert.ok(T[`${key}.named`][lang].includes('{name}'), `${key}.named ${lang}`);
      }
    }
  }
});

test('the name never follows a closing "!" or "?", in any language (the "Welcome back!, Alex" bug)', () => {
  for (const lang of LANG_CODES) {
    const tl = makeT(lang);
    for (const hour of HOURS) {
      for (const g of GENDERS) {
        const pool = returnGreetingKeys(hour, g);
        for (let i = 0; i < pool.length; i++) {
          const { line, salutation, isBirthday } = getGreeting('Alex', '', tl, g, new Date(2026, 9, 28, hour, 30), () => (i + 0.5) / pool.length);
          assert.equal(isBirthday, false);
          assert.equal(salutation, tl(pool[i]));
          assert.ok(line.includes('Alex'), `${lang} ${line}`);
          assert.doesNotMatch(line, /[!?¡¿]\s*,/, `${lang} ${line}`);
          assert.ok(!line.includes('{name}'), `${lang} ${line}`);
        }
      }
    }
  }
});

test('a line that ends in a mark keeps it at the end, after the name', () => {
  const at8 = new Date(2026, 9, 28, 8, 30);
  const pick = (key: string, g: Gender) => {
    const pool = returnGreetingKeys(8, g);
    const i = pool.indexOf(key);
    return () => (i + 0.5) / pool.length;
  };
  assert.equal(getGreeting('Alex', '', makeT('en'), 'm', at8, pick('greet.back.1.m', 'm')).line, 'Welcome back, Alex!');
  assert.equal(getGreeting('Alex', '', makeT('es'), 'f', at8, pick('greet.back.1.f', 'f')).line, '¡Bienvenida de nuevo, Alex!');
  assert.equal(getGreeting('Alex', '', makeT('es'), 'm', at8, pick('greet.back.4.m', 'm')).line, '¿Listo para despegar, Alex?');
  assert.equal(getGreeting('Alex', '', makeT('en'), 'x', at8, pick('greet.morning', 'x')).line, 'Good morning, Alex');
});
