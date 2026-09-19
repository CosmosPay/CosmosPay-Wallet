/**
 * `tauri dev` / `tauri build` for the desktop, with the dev icon on a local build.
 *
 *   npm run desktop:dev      # node scripts/tauri-desktop.ts dev
 *   npm run desktop:build    # node scripts/tauri-desktop.ts build [tauri args…]
 *
 * In CI this is `tauri <args>` and nothing else — see iconFlavor() in scripts/devIcons.ts.
 *
 * The desktop icon cannot be swapped the way the web one is. `tauri::generate_context!` embeds
 * the window icon at compile time and tauri-build writes the .ico into the Windows executable,
 * both from `bundle.icon` in src-tauri/tauri.conf.json. So the dev art has to reach them AS
 * CONFIG: Tauri merges a `--config` file into that one and hands the result to cargo as
 * TAURI_CONFIG, which is what both of them read. Overlaying `bundle.icon` is the whole change,
 * and the committed set in src-tauri/icons/ is never touched.
 *
 * The overlay's list is DERIVED from tauri.conf.json's own, entry for entry, so a format
 * added there cannot be missing here. The set is cut by `tauri icon` from a tinted copy of
 * resources/icon.png — the master the committed set was cut from — into dist/dev-icons/, and
 * only when that tinted master changed: the CLI takes seconds, and `desktop:dev` is run often.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { iconFlavor, tintPng } from './devIcons.ts';

const TAURI_JS = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');
const CONF = 'src-tauri/tauri.conf.json';
const MASTER = 'resources/icon.png';
const OUT = 'dist/dev-icons';
const SET = `${OUT}/desktop`;
/** The sha256 of the tinted master the set in SET was cut from. */
const STAMP = `${SET}/.master-sha256`;

/** The Tauri CLI, run by this Node — no shell, so no quoting to get wrong on Windows. */
function tauri(args: string[], stdio: SpawnSyncOptions['stdio'] = 'inherit') {
  const run = spawnSync(process.execPath, [TAURI_JS, ...args], { stdio });
  if (run.error) throw run.error;
  return run;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Cut the dev set if it is stale, write the overlay, return the overlay's absolute path. */
async function devIconOverlay(): Promise<string> {
  const conf = JSON.parse(await readFile(CONF, 'utf8')) as { bundle: { icon: string[] } };
  // tauri.conf.json's paths are relative to src-tauri/, and so are the overlay's.
  const icons = conf.bundle.icon.map((p) => {
    if (!p.startsWith('icons/')) throw new Error(`${CONF}: bundle.icon "${p}" is outside icons/ — no dev twin for it.`);
    return { overlay: `../${SET}/${p.slice('icons/'.length)}`, file: `${SET}/${p.slice('icons/'.length)}` };
  });

  const master = await tintPng(await readFile(MASTER));
  const sha = createHash('sha256').update(master).digest('hex');
  const fresh =
    (await readFile(STAMP, 'utf8').catch(() => '')) === sha &&
    (await Promise.all(icons.map((i) => exists(i.file)))).every(Boolean);

  if (!fresh) {
    await mkdir(OUT, { recursive: true });
    await writeFile(`${OUT}/icon.png`, master);
    // Piped, not inherited: it lists fifty files, the Android and iOS ones included, and none
    // of that is worth a screenful on every icon change. Shown only if it fails.
    const run = tauri(['icon', `${OUT}/icon.png`, '-o', SET], 'pipe');
    if (run.status !== 0) {
      process.stderr.write(run.stdout ?? '');
      process.stderr.write(run.stderr ?? '');
      throw new Error('tauri icon failed to cut the dev icon set.');
    }
    const missing: string[] = [];
    for (const i of icons) if (!(await exists(i.file))) missing.push(i.file);
    if (missing.length) throw new Error(`tauri icon did not write: ${missing.join(', ')}`);
    await writeFile(STAMP, sha);
  }

  const overlay = `${OUT}/tauri.dev-icons.conf.json`;
  await writeFile(overlay, JSON.stringify({ bundle: { icon: icons.map((i) => i.overlay) } }, null, 2));
  return resolve(overlay);
}

const args = process.argv.slice(2);
if (args[0] !== 'dev' && args[0] !== 'build') {
  console.error('usage: tauri-desktop.ts dev|build [tauri args…]');
  process.exit(2);
}

if (iconFlavor() === 'dev') {
  // Right after the subcommand, so it can never land behind a `--` that hands the rest to cargo.
  args.splice(1, 0, '--config', await devIconOverlay());
  console.log('tauri-desktop — dev icons (a local build). COSMOS_ICONS=release for one meant for distribution.');
}

process.exit(tauri(args).status ?? 1);
