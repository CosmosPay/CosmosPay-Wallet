/**
 * Write the app icon into the generated Xcode project — tinted on a local build.
 *
 * Run by `npm run ios:init` after the platform is generated, and again ahead of every
 * `ios:dev` and `ios:build`; also runnable on its own as `npm run ios:res`.
 *
 * The iOS twin of scripts/android-res.ts, for the reason that script gives: the generated
 * project outlives the build that made it, so the icon only follows the build if something
 * writes it every time. The source is src-tauri/icons/ios, the set `tauri icon` cut beside
 * the desktop one; a dev build sends each PNG through the tint in scripts/devIcons.ts.
 *
 * ONLY FILES THE ASSET CATALOG ALREADY HOLDS ARE WRITTEN. Its Contents.json belongs to the
 * generated project, and an image it does not list is one Xcode ignores and warns about, so
 * this replaces pixels and never changes which icons exist. The names line up because
 * `tauri icon` writes both sets under one naming scheme; if that ever stops being true this
 * writes nothing and says so, rather than breaking the build.
 *
 * Not yet run on a Mac outside CI, and CI never packages an iOS app — treat a change here as
 * untested until someone has looked at a home screen.
 */
import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { iconFlavor, tintPng } from './devIcons.ts';

const FROM = 'src-tauri/icons/ios';
const TO = 'src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Optional for the same reason as in android-res.ts: a checkout with only Android generated,
// or neither — every Windows and Linux one — must still get through `npm run ios:init`.
if (!(await exists(TO))) {
  console.log(`ios:res — no ${TO}/, skipping (generate it with \`npm run ios:init\`, on macOS).`);
  process.exit(0);
}

const flavor = iconFlavor();
const present = new Set(await readdir(TO));
let written = 0;
for (const name of await readdir(FROM)) {
  if (!name.endsWith('.png') || !present.has(name)) continue;
  const bytes = await readFile(join(FROM, name));
  await writeFile(join(TO, name), flavor === 'dev' ? await tintPng(bytes) : bytes);
  written++;
}
console.log(
  written
    ? `ios:res — ${written} icon(s) ${FROM}/ -> ${TO}/ [${flavor} icons]`
    : `ios:res — no file in ${FROM}/ matches a name in ${TO}/; nothing written.`,
);
