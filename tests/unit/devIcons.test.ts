/**
 * Which icon a build wears, and what the dev one looks like.
 *
 * The decision is the part that can hurt. The brand icon on a local build costs a developer
 * a second look; the dev tint on a CI build ships an amber icon to every user of a release.
 * So the rule is pinned in both directions, and the transform is checked on real pixels —
 * through sharp's own SVG renderer for the favicon — rather than trusted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { DEV_INK, DEV_TILE, iconFlavor, tintPng, tintSvg } from '../../scripts/devIcons.ts';

test('CI builds wear the brand, local builds the dev tint', () => {
  assert.equal(iconFlavor({ CI: 'true' }), 'release'); // GitHub Actions
  assert.equal(iconFlavor({ CI: '1' }), 'release');
  assert.equal(iconFlavor({}), 'dev');
  assert.equal(iconFlavor({ CI: '' }), 'dev');
  assert.equal(iconFlavor({ CI: 'false' }), 'dev');
  assert.equal(iconFlavor({ CI: '0' }), 'dev');
});

test('COSMOS_ICONS overrides CI in both directions', () => {
  assert.equal(iconFlavor({ COSMOS_ICONS: 'release' }), 'release');
  assert.equal(iconFlavor({ CI: 'true', COSMOS_ICONS: 'dev' }), 'dev');
});

test('an unknown COSMOS_ICONS is an error, not a fall-through to the default', () => {
  // `prod` falling through would be a local store build shipping amber without a word.
  assert.throws(() => iconFlavor({ COSMOS_ICONS: 'prod' }), /COSMOS_ICONS/);
  assert.throws(() => iconFlavor({ CI: 'true', COSMOS_ICONS: 'Release' }), /COSMOS_ICONS/);
});

/** One row of RGBA pixels as a PNG. */
const png = (...px: number[][]) =>
  sharp(Buffer.from(px.flat()), { raw: { width: px.length, height: 1, channels: 4 } })
    .png()
    .toBuffer();

const pixels = async (image: Buffer, channels: number) => {
  const raw = await sharp(image).raw().toBuffer();
  return Array.from({ length: raw.length / channels }, (_, i) => [...raw.subarray(i * channels, i * channels + channels)]);
};

test('the tint turns the dark tile amber and the light glyph black, alpha untouched', async () => {
  const out = await tintPng(await png([0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 0]));
  const [tile, glyph, clear] = await pixels(out, 4);
  assert.deepEqual(tile, [...DEV_TILE, 255]);
  assert.deepEqual(glyph, [...DEV_INK, 255]);
  // A transparent pixel stays transparent — the rounded corners and the adaptive foreground.
  assert.equal(clear[3], 0);
});

test('an opaque icon comes out opaque', async () => {
  // The App Store's 1024px icon may not carry an alpha channel at all.
  const opaque = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).png().toBuffer();
  const meta = await sharp(await tintPng(opaque)).metadata();
  assert.equal(meta.hasAlpha, false);
});

test('the SVG tint renders the same colours as the PNG one', async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1">' +
    '<rect width="1" height="1" fill="#000000"/><rect x="1" width="1" height="1" fill="#ffffff"/></svg>';
  const [tile, glyph] = await pixels(await sharp(Buffer.from(tintSvg(svg))).png().toBuffer(), 4);
  // Within a step or two: the renderer rounds on its own terms.
  const near = (got: number[], want: readonly number[]) => want.every((v, c) => Math.abs(got[c] - v) <= 2);
  assert.ok(near(tile, DEV_TILE), `tile rendered ${tile}`);
  assert.ok(near(glyph, DEV_INK), `glyph rendered ${glyph}`);
});

test('tintSvg refuses what is not an SVG rather than emitting a broken favicon', () => {
  assert.throws(() => tintSvg('<html></html>'), /not an SVG/);
});
