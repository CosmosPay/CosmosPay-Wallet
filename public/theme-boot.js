/**
 * Cosmos Wallet — first-paint theme.
 *
 * Loaded as a classic, blocking script in <head> (src/pages/index.astro), before any
 * module runs, so the very first frame already has the right canvas: without it a phone
 * in light mode would flash the dark default until the app's bundle loaded. External
 * rather than inline because the extension's CSP refuses inline scripts.
 *
 * A plain file served as is, with no bundler and no imports: it holds its own copies of
 * the storage key and the two canvas colours, and tests/unit/themeBoot.test.ts compares
 * them with src/state/usePreferences.ts, which owns them.
 */
(function () {
  var KEY = 'cosmos.theme';
  var COLOR = { dark: '#000000', light: '#ffffff' };
  var theme = 'dark';
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') theme = saved;
    else if (window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
  } catch (e) {
    /* storage or matchMedia unavailable: keep the dark default */
  }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', COLOR[theme]);
})();
