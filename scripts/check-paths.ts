/**
 * Repo guard: every `src/...` path cited in a comment, a stylesheet header or a
 * doc must actually exist on disk.
 *
 * Dead references drift silently — a comment pointing at a file that was renamed
 * or deleted is how a future reader gets sent down a rabbit hole. This guard
 * scans the repo for `src/<path>` citations (outside of import statements, which
 * use the `@/` alias) and fails CI when one doesn't resolve to a real file or
 * directory. Extensionless citations resolve like the bundler does (`.ts`,
 * `.tsx`, `.astro`, `.css`, ... and `/index.*`).
 *
 * Run via `npm run check:paths` (wired into `npm run check:guards`).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files we scan for `src/...` citations. Skip generated/binary/vendored dirs.
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.astro', '.css', '.md', '.json', '.yml', '.yaml', '.toml']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.astro', 'dist', 'android', 'ios', 'public', 'demo', 'extension-src']);

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.astro', '.css', '.md', '.json'];

/** Resolve a cited path like the bundler would: exact, then +ext, then /index.ext. */
function resolveCitation(cited: string): string | null {
  const candidates = [cited];
  if (!candidates.some((c) => EXTENSIONS.some((e) => c.endsWith(e)))) {
    for (const ext of EXTENSIONS) candidates.push(cited + ext);
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  for (const ext of EXTENSIONS) {
    const idx = join(cited, 'index' + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP_DIRS.has(name)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (SCAN_EXTS.has(extOf(full))) out.push(full);
  }
  return out;
}

function extOf(file: string): string {
  const base = file.slice(file.lastIndexOf(sep));
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot);
}

const files = walk(join(root, 'src'))
  .concat(walk(join(root, 'scripts')))
  .concat(walk(join(root, 'tests')))
  .concat(walk(join(root, 'readmes')));
for (const f of ['README.md', 'STORE_LISTING.md', 'CHANGELOG.md', 'CLAUDE.md', '.env.example']) {
  const p = join(root, f);
  if (existsSync(p)) files.push(p);
}

// `src/<path>` with a word boundary before `src` (so `extension-src/...` isn't a match).
const CITATION_RE = /(?:^|[^A-Za-z0-9_-])src\/[A-Za-z0-9_./-]+/g;
const TRAILING = /[.,;:)\]}'"`]+$/;

const errors: { file: string; cited: string; line: number }[] = [];
let checked = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  let m: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  while ((m = CITATION_RE.exec(text))) {
    checked += 1;
    const raw = m[0].replace(/^[^s]/, ''); // drop the leading non-word char captured by the group
    const cited = raw.replace(TRAILING, '');
    if (!cited.startsWith('src/')) continue;
    const abs = join(root, cited);
    if (!resolveCitation(abs)) {
      const line = text.slice(0, m.index).split('\n').length;
      errors.push({ file: relative(root, file), cited, line });
    }
  }
}

if (errors.length) {
  console.error(`✖ path guard failed (${errors.length} broken citation(s)):`);
  for (const e of errors) console.error(`  - ${e.file}:${e.line} cites "${e.cited}" which does not exist`);
  process.exit(1);
}
console.log(`✔ path guard passed: ${checked} src/... citations all resolve.`);
