/**
 * Scrolling the screen from anywhere in a desktop window (src/lib/scrollForward.ts): the
 * wheel's units and the keys that scroll a page. The DOM half is checked in a browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollKeyDistance, wheelPixels } from '@/lib/scrollForward';
import { SCROLL_ARROW_PX, WHEEL_LINE_PX } from '@/constants/ui';

test('a wheel counts in pixels, lines or pages, and comes out in pixels', () => {
  assert.equal(wheelPixels({ deltaY: 120, deltaMode: 0 }, 500), 120);
  assert.equal(wheelPixels({ deltaY: 3, deltaMode: 1 }, 500), 3 * WHEEL_LINE_PX);
  assert.equal(wheelPixels({ deltaY: -1, deltaMode: 2 }, 500), -500);
});

test('the page keys scroll by a line, most of a screen, or to an end', () => {
  assert.equal(scrollKeyDistance('ArrowDown', false, 500), SCROLL_ARROW_PX);
  assert.equal(scrollKeyDistance('ArrowUp', false, 500), -SCROLL_ARROW_PX);
  assert.equal(scrollKeyDistance('PageDown', false, 500), 450);
  assert.equal(scrollKeyDistance(' ', true, 500), -450);
  assert.equal(scrollKeyDistance('End', false, 500), Infinity);
  assert.equal(scrollKeyDistance('Home', false, 500), -Infinity);
});

test('every other key is left to whatever has the focus', () => {
  for (const key of ['Enter', 'Tab', 'a', 'ArrowLeft', 'Escape']) assert.equal(scrollKeyDistance(key, false, 500), null);
});
