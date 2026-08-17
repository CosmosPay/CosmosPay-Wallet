/**
 * The version the app shows is the version the app is.
 *
 * `APP_VERSION` sat at 1.1.0 while package.json said 1.2.3, so the welcome screen and
 * the About screen both reported a build that had not shipped for two releases. It is
 * a string in one file and a string in another; only a test keeps them equal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VERSION } from '@/constants/app';

test('APP_VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };
  assert.equal(APP_VERSION, pkg.version);
});
