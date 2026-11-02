/**
 * The interface languages and how the wallet picks one (`src/lib/i18n.ts`). Data only.
 *
 * English is the wallet's primary language (the owner's call, 2026-11-02): it is the
 * default and it is listed first. The device's own language is deliberately NOT consulted —
 * reading `navigator.languages` is what opened the wallet in Spanish for anyone whose phone
 * or browser asked for it, including the owner sharing it. Resolution is:
 *
 *   a language in the URL  →  the person's saved choice  →  English
 *
 * The URL forms are `?lang=xx` and an entry page `/<base>/xx/` (`src/pages/[lang]/index.astro`).
 */

/** Every supported code, English first. `Lang` (lib/i18n.ts) is derived from this list. */
export const LANG_CODES = ['en', 'es', 'pt', 'de', 'fr'] as const;

/** What a visit with nothing in the URL and nothing saved opens in. */
export const DEFAULT_LANG = 'en' satisfies (typeof LANG_CODES)[number];

/**
 * Where the person's choice is kept. Stays in `localStorage` on every build, including the
 * apps (`KEEP_IN_LOCAL_STORAGE` in src/lib/storage.ts), because `tNow` reads it synchronously.
 */
export const LANG_STORAGE_KEY = 'cosmos.lang';

/** The query parameter a link carries a language in: `https://cosmospay.lat/wallet/?lang=en`. */
export const LANG_QUERY_PARAM = 'lang';
