/**
 * Which language the wallet opens in: a language in the URL, then the saved choice, then
 * English — never the device's (src/constants/i18n.ts).
 *
 * The device rule is the one worth pinning. Reading `navigator.languages` is what opened the
 * wallet in Spanish for its owner and for everyone a link was shared with, and it is a
 * one-line "improvement" away from coming back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LANG, LANG_CODES, LANG_STORAGE_KEY } from '@/constants/i18n';
import {
  LANGUAGES,
  adoptUrlLang,
  ogLocale,
  parseLang,
  persistLang,
  readUrlLang,
  savedLang,
  setDocumentLang,
} from '@/lib/i18n';

const SITE = 'https://cosmospay.lat';
const BASE = '/wallet/';

/** A history double: what `adoptUrlLang` wrote, and the state it kept. */
function fakeHistory(state: unknown = { cosmosNav: 'x', path: [] }) {
  const calls: { state: unknown; url: string }[] = [];
  return {
    calls,
    state,
    replaceState(s: unknown, _title: string, url?: string | URL | null) {
      calls.push({ state: s, url: String(url) });
    },
  };
}

/** Run `fn` with `globalThis.navigator` asking for `languages`. */
function withDeviceLanguages(languages: string[], fn: () => void) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: languages[0], languages },
    configurable: true,
    writable: true,
  });
  try {
    fn();
  } finally {
    if (before) Object.defineProperty(globalThis, 'navigator', before);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

// Runs first: nothing has been chosen in this load yet, so the fallback is the default itself.
test('nothing saved opens in English, whatever language the device asks for', () => {
  localStorage.removeItem(LANG_STORAGE_KEY);
  try {
    withDeviceLanguages(['es-AR', 'es'], () => assert.equal(savedLang(), 'en'));
    withDeviceLanguages(['pt-BR'], () => assert.equal(savedLang(), 'en'));
    // A stored value this build does not know is no choice at all.
    localStorage.setItem(LANG_STORAGE_KEY, 'it');
    withDeviceLanguages(['it-IT', 'es'], () => assert.equal(savedLang(), 'en'));
  } finally {
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
  }
});

test('English is the default and the first language offered', () => {
  assert.equal(DEFAULT_LANG, 'en');
  assert.equal(LANG_CODES[0], 'en');
  assert.equal(LANGUAGES[0].code, 'en');
  // The picker lists exactly the supported codes, in the same order.
  assert.deepEqual(
    LANGUAGES.map((l) => l.code),
    [...LANG_CODES],
  );
});

test('a saved choice is kept', () => {
  try {
    for (const code of LANG_CODES) {
      localStorage.setItem(LANG_STORAGE_KEY, code);
      withDeviceLanguages(['es-AR'], () => assert.equal(savedLang(), code));
    }
  } finally {
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
  }
});

test('a link names a language loosely, and only one of the five', () => {
  assert.equal(parseLang('en'), 'en');
  assert.equal(parseLang('EN'), 'en');
  assert.equal(parseLang(' fr '), 'fr');
  assert.equal(parseLang('en-US'), 'en');
  assert.equal(parseLang('pt_BR'), 'pt');
  assert.equal(parseLang('de-DE-1996'), 'de');
  for (const bad of ['', null, undefined, 'xx', 'it', 'english', 'e', 'esp', '-es']) {
    assert.equal(parseLang(bad), null, String(bad));
  }
});

test('?lang= is read, and leaves the address with everything else intact', () => {
  assert.deepEqual(readUrlLang(`${SITE}/wallet/?lang=en`, BASE), { lang: 'en', rest: '/wallet/' });
  assert.deepEqual(readUrlLang(`${SITE}/wallet/?lang=pt-BR#top`, BASE), { lang: 'pt', rest: '/wallet/#top' });
  assert.deepEqual(readUrlLang(`${SITE}/wallet/earn/?lang=de`, BASE), { lang: 'de', rest: '/wallet/earn/' });

  // A SEP-7 request riding on the same link survives the language being taken out.
  const uri = 'web+stellar:pay?destination=GABC&amount=5';
  const found = readUrlLang(`${SITE}/wallet/?uri=${encodeURIComponent(uri)}&lang=es`, BASE);
  assert.equal(found?.lang, 'es');
  const rest = new URL(found!.rest, SITE);
  assert.equal(rest.pathname, '/wallet/');
  assert.equal(rest.searchParams.get('uri'), uri);
  assert.equal(rest.searchParams.has('lang'), false);
});

test('/wallet/xx/ is read, and the address goes back to the root', () => {
  for (const code of LANG_CODES) {
    assert.deepEqual(readUrlLang(`${SITE}/wallet/${code}/`, BASE), { lang: code, rest: '/wallet/' });
  }
  assert.deepEqual(readUrlLang(`${SITE}/wallet/fr`, BASE), { lang: 'fr', rest: '/wallet/' });
  assert.deepEqual(readUrlLang(`${SITE}/wallet/de/index.html`, BASE), { lang: 'de', rest: '/wallet/' });
  assert.deepEqual(readUrlLang(`${SITE}/wallet/PT/`, BASE), { lang: 'pt', rest: '/wallet/' });
  assert.deepEqual(readUrlLang(`${SITE}/wallet/es/?uri=x#h`, BASE), { lang: 'es', rest: '/wallet/?uri=x#h' });
});

test('?lang= wins over the path, and both leave the address', () => {
  assert.deepEqual(readUrlLang(`${SITE}/wallet/es/?lang=en`, BASE), { lang: 'en', rest: '/wallet/' });
  // An unknown parameter is ignored, so the path decides; the parameter is left where it was.
  assert.deepEqual(readUrlLang(`${SITE}/wallet/es/?lang=xx`, BASE), { lang: 'es', rest: '/wallet/?lang=xx' });
});

test('a URL that names no supported language is left alone', () => {
  for (const href of [
    `${SITE}/wallet/`,
    `${SITE}/wallet/?lang=xx`,
    `${SITE}/wallet/?lang=`,
    `${SITE}/wallet/xx/`,
    `${SITE}/wallet/earn/`,
    `${SITE}/wallet/approve/`,
    `${SITE}/wallet/en/earn/`, // only the entry page itself is a language
    `${SITE}/elsewhere/en/`, // outside the build's base
    'not a url',
  ]) {
    assert.equal(readUrlLang(href, BASE), null, href);
  }
});

test('the extension and the apps (base /) never carry a language, unless a link adds one', () => {
  assert.equal(readUrlLang('chrome-extension://abc/index.html', '/'), null);
  assert.equal(readUrlLang('chrome-extension://abc/sidepanel.html', '/'), null);
  assert.equal(readUrlLang('tauri://localhost/', '/'), null);
  assert.equal(readUrlLang('http://tauri.localhost/index.html', '/'), null);
  assert.deepEqual(readUrlLang('chrome-extension://abc/index.html?lang=pt', '/'), { lang: 'pt', rest: '/index.html' });
  // A local preview of a root build (`npm run serve:dist`).
  assert.deepEqual(readUrlLang('http://127.0.0.1:4321/en/', '/'), { lang: 'en', rest: '/' });
  // A base written without its trailing slash reads the same.
  assert.deepEqual(readUrlLang(`${SITE}/wallet/en/`, '/wallet'), { lang: 'en', rest: '/wallet/' });
});

test('a language in the URL wins over the saved choice and becomes it', () => {
  localStorage.setItem(LANG_STORAGE_KEY, 'es');
  const hist = fakeHistory();
  try {
    assert.equal(adoptUrlLang({ href: `${SITE}/wallet/?lang=en` }, hist, BASE), 'en');
    assert.equal(savedLang(), 'en');
    assert.equal(localStorage.getItem(LANG_STORAGE_KEY), 'en');
    // Off the address bar, with the entry's own state kept for the navigation history.
    assert.deepEqual(hist.calls, [{ state: hist.state, url: '/wallet/' }]);

    assert.equal(adoptUrlLang({ href: `${SITE}/wallet/fr/` }, hist, BASE), 'fr');
    assert.equal(savedLang(), 'fr');
    assert.equal(hist.calls.at(-1)?.url, '/wallet/');
  } finally {
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
  }
});

test('a URL without a language changes nothing', () => {
  localStorage.setItem(LANG_STORAGE_KEY, 'es');
  const hist = fakeHistory();
  try {
    assert.equal(adoptUrlLang({ href: `${SITE}/wallet/` }, hist, BASE), null);
    assert.equal(adoptUrlLang({ href: `${SITE}/wallet/?lang=klingon` }, hist, BASE), null);
    assert.equal(savedLang(), 'es');
    assert.deepEqual(hist.calls, []);
  } finally {
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
  }
});

test('a host that refuses replaceState still gets the language', () => {
  const hist = {
    state: null,
    replaceState() {
      throw new Error('SecurityError');
    },
  };
  try {
    assert.equal(adoptUrlLang({ href: `${SITE}/wallet/?lang=de` }, hist, BASE), 'de');
    assert.equal(savedLang(), 'de');
  } finally {
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
  }
});

test('blocked storage keeps the choice for the rest of the page load', () => {
  const real = globalThis.localStorage;
  const blocked = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('SecurityError');
    },
  } as unknown as Storage;
  Object.defineProperty(globalThis, 'localStorage', { value: blocked, configurable: true, writable: true });
  try {
    persistLang('pt');
    assert.equal(savedLang(), 'pt');
    assert.equal(adoptUrlLang({ href: `${SITE}/wallet/es/` }, fakeHistory(), BASE), 'es');
    assert.equal(savedLang(), 'es');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true });
    localStorage.setItem(LANG_STORAGE_KEY, 'en');
  }
});

test('<html lang> is set to the language', () => {
  const attrs: Record<string, string> = {};
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    value: { documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v) } },
    configurable: true,
    writable: true,
  });
  try {
    setDocumentLang('fr');
    assert.equal(attrs.lang, 'fr');
  } finally {
    if (before) Object.defineProperty(globalThis, 'document', before);
    else delete (globalThis as { document?: unknown }).document;
  }
  // No document (Node, a worker): nothing to set, and nothing thrown.
  assert.doesNotThrow(() => setDocumentLang('en'));
});

test('og:locale spells each language as Open Graph does', () => {
  assert.equal(ogLocale('en'), 'en_US');
  assert.equal(ogLocale('es'), 'es_ES');
  assert.equal(ogLocale('pt'), 'pt_BR');
  assert.equal(ogLocale('de'), 'de_DE');
  assert.equal(ogLocale('fr'), 'fr_FR');
});
