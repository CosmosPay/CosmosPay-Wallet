/**
 * Generate the Android launcher icons and splash screens from the brand logo.
 *
 *   npm run android:icons        # rewrites resources/android/ from public/logo-white.png
 *
 * Output goes to resources/android/, which IS committed — `android/` is not, so anything
 * written straight into it is lost on the next clone and the app ships Capacitor's default
 * logo again. scripts/android-res.ts copies this tree back in after every sync.
 *
 * Two things this gets right that a generic icon generator does not, and that `tauri icon`
 * does not do either — which is why the Android art is generated here and only the DESKTOP
 * icon set comes from the Tauri CLI (see scripts/desktop-icon.ts):
 *
 * - **The flat icons are opaque.** `ic_launcher.png` / `ic_launcher_round.png` are what
 *   Android below API 26 uses, and what several previews fall back to. Generated from a
 *   white-on-transparent logo they come out white-on-nothing — invisible against any light
 *   surface, which reads as "the icon did not get set".
 * - **The adaptive background is the brand colour**, not the #FFFFFF left in the template.
 *   White logo on white background is invisible in a different way.
 *
 * Sizes are Android's density ladder; the adaptive pair is 108dp because that is what the
 * launcher masks down to 72dp of guaranteed-visible circle.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const SOURCE = 'public/logo-white.png';
const OUT = 'resources/android';
/** ic_launcher.png / ic_launcher_round.png — px per density bucket. */
const FLAT = { ldpi: 36, mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
/** ic_launcher_foreground.png / ic_launcher_background.png — the 108dp adaptive canvas. */
const ADAPTIVE = { ldpi: 81, mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
/** splash.png, portrait; landscape is the same list transposed. */
const SPLASH = {
  ldpi: [240, 320],
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
} as const;

// How much of each canvas the glyph fills. The adaptive foreground can afford 85% because
// the launcher insets it by 16.7% before masking; the flat icon is shown as-is, so the same
// number there would leave the glyph touching the edges.
const FOREGROUND_SCALE = 0.85;
const FLAT_SCALE = 0.6;
const SPLASH_SCALE = 0.2;

// #080808 — `--bg` in src/styles/theme.css, and the window backgroundColor in
// src-tauri/tauri.conf.json. The icon sits on the same surface the app opens onto.
// As channels rather than a hex string because that is the only form sharp takes.
const rgb = { r: 8, g: 8, b: 8, alpha: 1 };
const clear = { r: 0, g: 0, b: 0, alpha: 0 };

/** The logo, resized to fill `size` px, ready to composite. */
const glyph = (size: number) =>
  sharp(SOURCE).resize(size, size, { fit: 'contain', background: clear }).png().toBuffer();

/** A canvas of `background`, with the logo centred at `scale` of the shorter side. */
async function compose(width: number, height: number, scale: number, background: typeof rgb | typeof clear) {
  const logo = await glyph(Math.round(Math.min(width, height) * scale));
  return sharp({ create: { width, height, channels: 4, background } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/** Same, then masked to a circle — what `ic_launcher_round` means. */
async function round(size: number) {
  const square = await compose(size, size, FLAT_SCALE, rgb);
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(square).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
}

async function emit(dir: string, name: string, data: Buffer) {
  await mkdir(join(OUT, dir), { recursive: true });
  await writeFile(join(OUT, dir, name), data);
}

// A full rewrite, not a merge: a density dropped from the tables above must disappear from
// the tree too, or scripts/android-res.ts keeps copying an orphan nobody generates any more.
await rm(OUT, { recursive: true, force: true });

for (const [density, size] of Object.entries(FLAT)) {
  await emit(`mipmap-${density}`, 'ic_launcher.png', await compose(size, size, FLAT_SCALE, rgb));
  await emit(`mipmap-${density}`, 'ic_launcher_round.png', await round(size));
}

for (const [density, size] of Object.entries(ADAPTIVE)) {
  await emit(`mipmap-${density}`, 'ic_launcher_foreground.png', await compose(size, size, FOREGROUND_SCALE, clear));
  await emit(
    `mipmap-${density}`,
    'ic_launcher_background.png',
    await sharp({ create: { width: size, height: size, channels: 4, background: rgb } }).png().toBuffer(),
  );
}

// The inset is what turns the 108dp canvas into the 72dp the launcher guarantees is visible,
// whatever mask shape the device applies.
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background>
        <inset android:drawable="@mipmap/ic_launcher_background" android:inset="16.7%" />
    </background>
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%" />
    </foreground>
</adaptive-icon>
`;
await emit('mipmap-anydpi-v26', 'ic_launcher.xml', Buffer.from(adaptiveXml));
await emit('mipmap-anydpi-v26', 'ic_launcher_round.xml', Buffer.from(adaptiveXml));

for (const [density, [w, h]] of Object.entries(SPLASH)) {
  const portrait = await compose(w, h, SPLASH_SCALE, rgb);
  const landscape = await compose(h, w, SPLASH_SCALE, rgb);
  // The app is dark in both modes, so the night variants are the same image — written out
  // rather than aliased because Android resolves drawable-night-* by directory, not by link.
  for (const dir of [`drawable-port-${density}`, `drawable-port-night-${density}`]) {
    await emit(dir, 'splash.png', portrait);
  }
  for (const dir of [`drawable-land-${density}`, `drawable-land-night-${density}`]) {
    await emit(dir, 'splash.png', landscape);
  }
}

// The undifferentiated fallbacks, for a device that matches no density bucket. Both portrait:
// a phone with no density qualifier is not a landscape device, and a generator emitting
// a 320x240 night splash next to a 320x480 day one was a quirk worth not reproducing.
const fallback = await compose(SPLASH.mdpi[0], SPLASH.mdpi[1], SPLASH_SCALE, rgb);
await emit('drawable', 'splash.png', fallback);
await emit('drawable-night', 'splash.png', fallback);

console.log(`android icons + splashes written to ${OUT}/ from ${SOURCE}`);
