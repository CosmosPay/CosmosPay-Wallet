/**
 * Copy committed Android resources into the Capacitor-generated native project.
 *
 * Capacitor's `cap sync` regenerates the `android/` tree from scratch, so any
 * assets written directly into `android/app/src/main/res/` are lost on every
 * sync. This script re-populates the native resource tree from the *committed*
 * source of truth at `resources/android/` **after** `cap sync` runs.
 *
 * Usage (wired into package.json scripts; see cap:sync / cap:android):
 *   node --disable-warning=ExperimentalWarning --experimental-strip-types \
 *        scripts/sync-android-assets.ts
 *
 * The `resources/android/` tree mirrors the standard Android resource layout:
 *   drawable/          — XML vector drawables + colours
 *   mipmap-anydpi-v26/ — adaptive-icon XML definitions
 *   values/            — colour resources
 *
 * Because these are XML resources (not generated PNGs), the project does not
 * depend on `sharp` or `@capacitor/assets`. The icon renders as an adaptive
 * icon on API 26+ devices and falls back to the template icon on older ones.
 * If a density-specific PNG ladder is needed for legacy devices, run:
 *   npx tsx scripts/generate-android-icons.ts
 * (requires `sharp` — install with `npm install -D sharp`).
 *
 * Brand colour:  #080808  (Cosmos Pay dark background)
 * Brand logo:    public/logo-white.png / public/favicon.svg
 */

import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const RESOURCE_SRC = join(ROOT, 'resources', 'android');
const RESOURCE_DST = join(ROOT, 'android', 'app', 'src', 'main', 'res');

async function syncAssets() {
  if (!existsSync(RESOURCE_SRC)) {
    console.error('resources/android/ not found — run from the project root.');
    process.exit(1);
  }

  if (!existsSync(join(ROOT, 'android'))) {
    console.log('android/ not found — run `npx cap add android` first, then `npm run cap:sync`.');
    process.exit(1);
  }

  console.log('Syncing Android resources from resources/android/ → android/app/src/main/res/');

  const entries = await readdir(RESOURCE_SRC, { withFileTypes: true, recursive: true });
  let copied = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const relative = join(entry.path.replace(RESOURCE_SRC, ''), entry.name).replace(/^\//, '');
    const src = join(RESOURCE_SRC, relative);
    const dst = join(RESOURCE_DST, relative);

    await mkdir(dirname(dst), { recursive: true });
    await cp(src, dst, { force: true });
    copied++;
  }

  console.log(`✓ ${copied} resource files synced to android/app/src/main/res/`);
}

syncAssets().catch((err) => {
  console.error('Asset sync failed:', err);
  process.exit(1);
});
