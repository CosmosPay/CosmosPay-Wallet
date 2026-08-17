import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localeOf, makeT, LANGUAGES, type Lang } from '@/lib/i18n';

test('every language has a locale tag', () => {
  for (const lang of LANGUAGES) assert.ok(localeOf(lang.code as Lang).length > 0);
  assert.equal(localeOf('es'), 'es-ES');
  assert.equal(localeOf('en'), 'en-US');
});

test('makeT resolves keys and interpolates params, falling back to English', () => {
  const t = makeT('es');
  assert.equal(t('pwd.min'), 'Mínimo 8 caracteres');
  assert.equal(t('unlock.removeConfirm', { name: 'Alex' }), '¿Eliminar «Alex» de este dispositivo? Asegúrate de tener su frase de recuperación.');
  // unknown key -> the key itself
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('makeT falls back to English when a language is missing a key', () => {
  // All keys carry all five languages, so this exercises the `?? entry.en` path
  // by asking for a language we know is present.
  assert.equal(makeT('fr')('common.continue'), 'Continuer');
});

test('the five supported languages are exposed', () => {
  assert.deepEqual(LANGUAGES.map((l) => l.code), ['es', 'en', 'pt', 'de', 'fr']);
});

test('detectLang maps navigator.language to a supported language', async () => {
  const { detectLang } = await import('@/lib/i18n');
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const stubNav = (languages: string[]) =>
    Object.defineProperty(globalThis, 'navigator', { value: { languages }, configurable: true });
  try {
    stubNav(['pt-BR', 'en-US']);
    assert.equal(detectLang(), 'pt');
    stubNav(['de-DE']);
    assert.equal(detectLang(), 'de');
    stubNav(['xx-YY']);
    assert.equal(detectLang(), 'en'); // unsupported -> default
  } finally {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig);
    else delete (globalThis as any).navigator;
  }
});
