/**
 * public/theme-boot.js paints the first frame before any module runs, so it cannot import
 * the preference slice and keeps its own copies of the storage key and the canvas colours.
 * A rename on one side alone still builds — and leaves a first paint in the wrong theme,
 * or a choice the boot script never reads. This keeps the copies equal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_COLOR, THEME_KEY } from '@/state/usePreferences';

const boot = readFileSync(join(process.cwd(), 'public', 'theme-boot.js'), 'utf8');

test('theme-boot.js reads the key the preference slice writes', () => {
  assert.match(boot, new RegExp(`var KEY = '${THEME_KEY.replace('.', '\\.')}';`));
});

test('theme-boot.js paints the browser chrome with the same colours', () => {
  assert.ok(boot.includes(`dark: '${THEME_COLOR.dark}'`), 'dark colour differs');
  assert.ok(boot.includes(`light: '${THEME_COLOR.light}'`), 'light colour differs');
});

test('the page loads theme-boot.js before anything else can paint', () => {
  const page = readFileSync(join(process.cwd(), 'src', 'pages', 'index.astro'), 'utf8');
  const at = page.indexOf('theme-boot.js');
  assert.ok(at > 0, 'index.astro does not load theme-boot.js');
  assert.ok(at < page.indexOf('<body'), 'theme-boot.js must be in <head>');
});
