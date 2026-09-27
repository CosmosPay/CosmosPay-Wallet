/**
 * The dev icon: how a LOCAL build says it is one.
 *
 * The wallet runs in several places at once while it is being worked on — the deployed web
 * app next to `npm run dev`, the store extension next to an unpacked one, the installed
 * desktop release next to `tauri dev`, the CI APK next to `tauri android dev` — and with one
 * icon between them the only way to tell which window is which is to open it. So every build
 * that did not come out of CI swaps the brand's dark tile for an amber one, glyph in black,
 * and every build that did keeps the brand.
 *
 * Nothing dev is committed. The dev art is DERIVED from the release art at build time by the
 * one colour transform below, so a logo change cannot leave a stale dev copy behind — there
 * is no copy. And nothing committed is ever tinted: every surface writes the result somewhere
 * a build owns, so a local build cannot dirty the tree with an amber icon someone commits.
 *
 *   web + extension   devIconsIntegration(), from astro.config.ts — tinted in dist/web, which
 *                     scripts/build-extension.ts packages, so the extension inherits it
 *   desktop           scripts/tauri-desktop.ts, a `--config` overlay on `bundle.icon`
 *   Android           scripts/android-res.ts, on the way into the generated project
 *   iOS               scripts/ios-res.ts, the same for the asset catalog
 *
 * `tests/unit/devIcons.test.ts` pins the decision and checks the transform on real pixels.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
// Static, not `await import()` on first use: astro.config.ts loads this module through Vite's
// module runner, which is already closed by `astro:build:done` — a lazy import there fails.
import sharp from 'sharp';

export type IconFlavor = 'dev' | 'release';

/**
 * Which icon this build wears. `CI` decides, unless COSMOS_ICONS says otherwise.
 *
 * The override exists for the dangerous direction. The brand icon on a local build costs a
 * developer a second look; the tint on a build meant for users puts an amber icon in a store
 * listing — and a store upload built on a laptop gets the tint by default. So
 * `COSMOS_ICONS=release` forces the brand art locally, `COSMOS_ICONS=dev` forces the tint in
 * CI, and any other value THROWS: `COSMOS_ICONS=prod` falling through to the default would be
 * the one typo that ships the wrong icon without a word.
 */
export function iconFlavor(env: Record<string, string | undefined> = process.env): IconFlavor {
  const forced = env.COSMOS_ICONS?.trim();
  if (forced) {
    if (forced === 'dev' || forced === 'release') return forced;
    throw new Error(`COSMOS_ICONS must be "dev" or "release", not "${forced}".`);
  }
  // Every CI this repo could plausibly run on sets `CI`, GitHub Actions included. `false` and
  // `0` are what a developer types to switch a tool's CI mode OFF, so they mean local here too.
  const ci = env.CI?.trim().toLowerCase();
  return ci && ci !== 'false' && ci !== '0' ? 'release' : 'dev';
}

/** The dev tile, as RGB. Amber: the colour a canary or nightly channel already means. */
export const DEV_TILE = [255, 176, 0] as const;

/** What the glyph turns into — the brand's black, `--bg` in src/styles/theme.css. */
export const DEV_INK = [0, 0, 0] as const;

/** Rec. 709 luma weights. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * The transform, as the 4x5 matrix an SVG `feColorMatrix` takes (channels in 0..1).
 *
 * Every brand icon is two-tone — a light glyph on a dark tile — so mapping luminance onto a
 * two-colour ramp is the whole job: dark becomes DEV_TILE, light becomes DEV_INK, antialiased
 * edges land in between. Alpha passes through, so rounded corners and an adaptive icon's
 * transparent foreground survive. The PNG path applies this same matrix, so the favicon and
 * the raster icons cannot drift into two shades of amber.
 */
const MATRIX: readonly (readonly number[])[] = [
  ...[0, 1, 2].map((c) => {
    const k = (DEV_INK[c] - DEV_TILE[c]) / 255;
    return [k * LUMA[0], k * LUMA[1], k * LUMA[2], 0, DEV_TILE[c] / 255];
  }),
  [0, 0, 0, 1, 0],
];

/** A PNG, tinted. Keeps the source's alpha layout: an opaque icon comes out opaque. */
export async function tintPng(input: Buffer): Promise<Buffer> {
  const { hasAlpha } = await sharp(input).metadata();
  const { data, info } = await sharp(input)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`tintPng: expected RGBA, got ${info.channels} channels.`);

  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    for (let c = 0; c < 3; c++) {
      const [kr, kg, kb, , offset] = MATRIX[c];
      data[i + c] = Math.round(kr * r + kg * g + kb * b + offset * 255);
    }
  }

  const out = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  return (hasAlpha ? out : out.removeAlpha()).png().toBuffer();
}

/**
 * An SVG, tinted — by wrapping its content in the same matrix as a filter, so the vector
 * stays a vector and nothing about its paths has to be understood.
 */
export function tintSvg(svg: string): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  const close = svg.lastIndexOf('</svg>');
  if (!open || close < open.index) throw new Error('tintSvg: not an SVG document.');
  const start = open.index + open[0].length;
  const values = MATRIX.flat().map((v) => +v.toFixed(6)).join(' ');
  return (
    svg.slice(0, start) +
    `<filter id="cosmos-dev-icon" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="${values}"/></filter>` +
    `<g filter="url(#cosmos-dev-icon)">` +
    svg.slice(start, close) +
    `</g>` +
    svg.slice(close)
  );
}

/**
 * The files under public/ that are the app's own icon: the favicon, and the PNG set the
 * extension manifest names. Anchored at the END so it matches a request under any `base`.
 */
const WEB_ICON = /(?:^|\/)(favicon\.svg|icons\/[\w.-]+\.png)$/;

async function tintFile(path: string): Promise<Buffer> {
  const bytes = await readFile(path);
  return path.endsWith('.svg') ? Buffer.from(tintSvg(bytes.toString('utf8'))) : tintPng(bytes);
}

/**
 * The web half: `astro dev` serves the tinted icons, `astro build` writes them into dist/web.
 *
 * Two hooks because public/ reaches the browser two ways. The dev server reads it straight
 * off disk, so the tint goes in as middleware — registered from `configureServer` directly,
 * which puts it AHEAD of Vite's own public-file handler. A build copies it into the outDir,
 * which `astro build` wipes first, so tinting there in place never tints twice.
 *
 * Only added by astro.config.ts when iconFlavor() says `dev`; a release build never loads it.
 */
export function devIconsIntegration(): AstroIntegration {
  return {
    name: 'cosmos:dev-icons',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'cosmos:dev-icons',
                apply: 'serve',
                configureServer(server) {
                  server.middlewares.use((req, res, next) => {
                    const icon = WEB_ICON.exec(new URL(req.url ?? '/', 'http://localhost').pathname)?.[1];
                    if (!icon) return next();
                    tintFile(join(server.config.publicDir, icon)).then(
                      (body) => {
                        res.setHeader('Content-Type', icon.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
                        // A browser that cached the brand favicon from a release build on the
                        // same origin would otherwise keep showing it.
                        res.setHeader('Cache-Control', 'no-store');
                        res.end(body);
                      },
                      // Not in public/ after all: let Vite answer, 404 included.
                      () => next(),
                    );
                  });
                },
              },
            ],
          },
        });
      },
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const files = [
          ...(await readdir(root)),
          ...(await readdir(join(root, 'icons')).catch(() => [] as string[])).map((f) => `icons/${f}`),
        ];
        // Listed rather than assumed, so a missing file is skipped and a failing tint is not:
        // a build that half-applied the dev icon is worse than one that stopped.
        const targets = files.filter((p) => WEB_ICON.test(p));
        for (const rel of targets) await writeFile(join(root, rel), await tintFile(join(root, rel)));
        logger.warn(
          `dev icons on ${targets.length} file(s) — a local build. COSMOS_ICONS=release for one meant for distribution.`,
        );
      },
    },
  };
}
