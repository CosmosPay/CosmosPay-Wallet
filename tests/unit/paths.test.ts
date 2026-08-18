/**
 * Every file path this repo cites in prose has to exist.
 *
 * The refactor moved 252 files and left the documentation pointing at the old tree:
 * 30 stylesheet headers named `src/components/…` paths deleted in the same commit,
 * and CLAUDE.md — the file an agent is told to obey — sent `staggerClass` to a module
 * that does not exist. Nothing failed, because prose is not compiled.
 *
 * This is the cheapest check that would have caught it. It cannot see a claim that is
 * false about a path that DOES exist ("ui.ts has been deleted"), so it is a floor,
 * not a proof.
 *
 * Case is part of the path. `existsSync` disagrees — it is case-insensitive on Windows
 * and on default macOS volumes — so a header naming `ScanQr.tsx` for a file called
 * `ScanQR.tsx` passed on the machine that wrote it and failed in CI on Linux, which is
 * exactly how it shipped. The check below resolves one segment at a time against the
 * real directory listing, so it means the same thing on every platform.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

/** Files whose comments and prose are scanned. */
const SCANNED_DIRS = ['src', 'scripts', 'tests'];
const SCANNED_EXT = /\.(ts|tsx|css|astro|mjs|md)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.astro', 'android', 'ios']);

/**
 * A path token, with a real extension.
 *
 * Two shapes, because half the stale references had no `src/` on the front: a
 * stylesheet header naming a deleted `molecules/` path, a comment pointing at
 * `styles/features/fiat/forms.css`. Requiring the `src|scripts|tests` prefix made ten
 * of them invisible, including the two the previous review had already listed by name.
 * The second alternative is anchored on the directory names that exist under `src/`,
 * so it catches those without matching every `host/path.html` in a URL.
 */
const SRC_DIRS = 'app|ui|features|state|hooks|lib|constants|styles|pages|components|molecules|atoms|organisms';
const EXT = '(?:ts|tsx|css|astro|mjs|json|html)';
const PATH_RE = new RegExp(String.raw`\b(?:(?:src|scripts|tests)|(?:${SRC_DIRS}))\/[A-Za-z0-9_@./-]+\.${EXT}\b`, 'g');

/** Placeholders and globs are documentation, not references. */
const isTemplate = (p: string) => /[<>*${}…]/.test(p);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Directory listings, memoised — the scan resolves thousands of tokens over the same tree. */
const listings = new Map<string, Set<string>>();
function entriesOf(dir: string): Set<string> {
  const cached = listings.get(dir);
  if (cached) return cached;
  let entries: Set<string>;
  try {
    entries = new Set(readdirSync(dir));
  } catch {
    entries = new Set(); // not a directory, or unreadable: nothing resolves under it
  }
  listings.set(dir, entries);
  return entries;
}

/** `existsSync(join(base, rel))`, but every segment must match the real name exactly. */
function existsExact(base: string, rel: string): boolean {
  let dir = base;
  for (const segment of rel.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (!entriesOf(dir).has(segment)) return false;
    dir = join(dir, segment);
  }
  return true;
}

test('every path cited in code comments and docs exists on disk', () => {
  const files = [
    ...SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) => SCANNED_EXT.test(f)),
    join(ROOT, 'CLAUDE.md'),
    join(ROOT, 'README.md'),
    ...walk(join(ROOT, 'readmes')),
  ];

  const broken: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.match(PATH_RE) ?? []) {
      if (isTemplate(match)) continue;
      // An unrooted token is relative to `src/` — that is where the tree it names lives.
      if (existsExact(ROOT, match) || existsExact(join(ROOT, 'src'), match)) continue;
      broken.push(`${relative(ROOT, file).replaceAll('\\', '/')} -> ${match}`);
    }
  }

  assert.deepEqual(broken, [], `paths cited but missing:\n  ${broken.join('\n  ')}`);
});
