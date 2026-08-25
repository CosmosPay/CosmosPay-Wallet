/**
 * Build the 1024px master the desktop icon set is cut from.
 *
 *   npm run desktop:icons    # this, then `tauri icon resources/icon.png`
 *
 * `public/logo-white.png` is a white glyph on transparency, which is right for the app's
 * own dark chrome and wrong for every desktop icon surface: a Windows taskbar in light
 * mode, a macOS Dock, a GNOME grid. Handed straight to `tauri icon` it produces an app
 * that looks uninstalled. The same trap `scripts/android-icons.ts` documents for the flat
 * launcher icons, one platform over — so the fix is the same one: composite the glyph onto
 * the brand background first and ship an OPAQUE master.
 *
 * Output is `resources/icon.png`, the committed master. `src-tauri/icons/` — the eleven
 * files `tauri icon` cuts from it — is committed too, and that is not the usual "generated
 * output stays out of the repo" call: `tauri::generate_context!` EMBEDS those files at
 * compile time, so a fresh clone could not run `cargo check`, let alone CI, without them.
 * Regenerate both together with `npm run desktop:icons`.
 */
import sharp from 'sharp';

const SOURCE = 'public/logo-white.png';
const OUT = 'resources/icon.png';

/** --bg in src/styles/theme.css, and the window backgroundColor in tauri.conf.json. */
const BG = { r: 8, g: 8, b: 8, alpha: 1 };

/** The master every other size is downscaled from — what `tauri icon` asks for. */
const SIZE = 1024;

/**
 * How much of the canvas the glyph fills.
 *
 * Lower than the adaptive-icon 85% and for the opposite reason: no desktop launcher insets
 * the art before drawing it, so this margin is the only thing between the glyph and the
 * edge of the tile. It matches FLAT_SCALE in scripts/android-icons.ts, which is the same
 * situation on Android below API 26.
 */
const SCALE = 0.62;

const glyph = await sharp(SOURCE)
  .resize(Math.round(SIZE * SCALE), Math.round(SIZE * SCALE), {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: BG } })
  .composite([{ input: glyph, gravity: 'centre' }])
  .png()
  .toFile(OUT);

console.log(`${OUT} — ${SIZE}x${SIZE} written from ${SOURCE}`);
