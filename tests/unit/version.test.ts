/**
 * The version the app shows is the version the app is — now by construction.
 *
 * This file used to compare two hand-maintained strings, and it could not do the job:
 * `.github/workflows/release-extension.yml` runs the suite in a `verify` job that gates
 * the release, then bumps package.json in a LATER job, so the assertion always saw the
 * pre-bump tree, always passed, and the drift the bot created surfaced on the next
 * developer's push — where, because `verify` gates releases, it blocked every release
 * until someone hand-edited a constant. It had already drifted twice (1.1.0, then
 * 1.2.3) before anyone noticed.
 *
 * `APP_VERSION` is now derived from package.json via Vite `define` (astro.config.ts),
 * so the equality below holds by construction. What is worth testing is that it STAYS
 * derived: the second assertion is a fact guard in the style of `paths.test.ts`, and it
 * is the one that fails if someone pastes a literal back in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VERSION } from '@/constants/app';

const repoRoot = join(import.meta.dirname, '..', '..');

test('APP_VERSION resolves to the version in package.json', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string };
  // Supplied by tests/setup.mjs here and by Vite `define` in a build — same file, so a
  // mismatch means the injection broke, not that two strings drifted.
  assert.equal(APP_VERSION, pkg.version);
});

test('APP_VERSION stays derived — no version literal in src/constants/app.ts', () => {
  const src = readFileSync(join(repoRoot, 'src', 'constants', 'app.ts'), 'utf8');
  const assignment = /export const APP_VERSION\s*=\s*(.+);/.exec(src);
  assert.ok(assignment, 'APP_VERSION is no longer exported from src/constants/app.ts');
  assert.equal(
    assignment[1].trim(),
    '__APP_VERSION__',
    'APP_VERSION must read the injected __APP_VERSION__, never a literal — a literal is a second copy, and the release bot only bumps package.json',
  );
});
