/**
 * The release version must only ever go forward.
 *
 * These are not hypotheses. Every regression asserted against below is one this repository
 * actually published, and the tag list in REAL_TAGS is the one that was live when the bug was
 * found — v1.4.1 released on 2026-08-24, then v1.3.1-dev.55 on 2026-08-25.
 *
 * Imported by relative path because tests/alias-hook.mjs only maps `@/` onto `src/`, and this
 * module is build tooling rather than app code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBump,
  compareVersions,
  formatVersion,
  highestCore,
  highestStable,
  nextVersion,
  parseVersion,
} from '../../scripts/release-version.ts';

const v = (s: string) => {
  const parsed = parseVersion(s);
  assert.ok(parsed, `fixture ${s} should parse`);
  return parsed;
};

/** The tags this repo carried when the regression was reported. */
const REAL_TAGS = [
  'v1.2.4-dev.27', 'v1.3.0-dev.28', 'v1.3.0-dev.29', 'v1.2.4-dev.30', 'v1.2.4-dev.31',
  'v1.3.0-dev.32', 'v1.2.4-dev.33', 'v1.2.4-dev.34', 'v1.2.4', 'v1.2.5-dev.38', 'v1.2.5',
  'v1.3.0-dev.40', 'v1.3.0-dev.41', 'v1.3.0-dev.42', 'v1.3.0-dev.43', 'v1.3.0-dev.44',
  'v1.3.0', 'v1.3.1-dev.46', 'v1.4.0-dev.47', 'v1.3.1-dev.48', 'v1.4.0', 'v1.4.0-dev.50',
  'v1.4.0-dev.51', 'v1.4.1', 'v1.3.1-dev.55',
];

test('parseVersion takes a tag with or without its v, and rejects the rest', () => {
  assert.deepEqual(v('1.4.1'), { major: 1, minor: 4, patch: 1, pre: [] });
  assert.deepEqual(v('v1.4.1'), { major: 1, minor: 4, patch: 1, pre: [] });
  // The prerelease is SPLIT, and a numeric identifier becomes a number — `dev.9` has to
  // compare below `dev.10`, which it cannot do as a string.
  assert.deepEqual(v('v1.3.1-dev.55').pre, ['dev', 55]);
  for (const bad of ['', 'v1.4', '1.4.1.2', 'latest', 'v1.4.1+abc', 'v1.-4.1']) {
    assert.equal(parseVersion(bad), null, `${bad} must not parse`);
  }
});

test('formatVersion round-trips what parseVersion read', () => {
  for (const s of ['1.4.1', '1.3.1-dev.55', '2.0.0-rc.1.2']) {
    assert.equal(formatVersion(v(s)), s);
  }
});

test('compareVersions ranks a release above its own prereleases', () => {
  // The rule that makes -dev.N a PREVIEW of a release rather than a successor to it.
  assert.equal(compareVersions(v('1.4.0'), v('1.4.0-dev.51')), 1);
  assert.equal(compareVersions(v('1.4.0-dev.51'), v('1.4.0')), -1);
  assert.equal(compareVersions(v('1.4.0'), v('1.4.0')), 0);
});

test('compareVersions orders dev builds numerically, not as strings', () => {
  assert.equal(compareVersions(v('1.4.0-dev.9'), v('1.4.0-dev.10')), -1);
  assert.equal(compareVersions(v('1.4.0-dev.51'), v('1.4.0-dev.50')), 1);
  // Core first, always: a higher run number cannot lift a lower core.
  assert.equal(compareVersions(v('1.3.1-dev.55'), v('1.4.0-dev.51')), -1);
});

test('compareVersions follows semver for mixed and shorter identifiers', () => {
  assert.equal(compareVersions(v('1.0.0-dev.5'), v('1.0.0-dev.5.1')), -1); // shorter loses
  assert.equal(compareVersions(v('1.0.0-1'), v('1.0.0-alpha')), -1); // numeric ranks below
  assert.equal(compareVersions(v('1.0.0-alpha'), v('1.0.0-beta')), -1);
});

test('highestStable ignores prereleases; highestCore does not', () => {
  assert.equal(formatVersion(highestStable(REAL_TAGS)), '1.4.1');
  assert.equal(formatVersion(highestCore(REAL_TAGS)), '1.4.1');
  // A dev branch previewing further ahead than anything released raises the floor without
  // becoming the base — see the runaway test below for why that distinction matters.
  const previewing = [...REAL_TAGS, 'v1.5.0-dev.60'];
  assert.equal(formatVersion(highestStable(previewing)), '1.4.1');
  assert.equal(formatVersion(highestCore(previewing)), '1.5.0');
});

test('highestStable falls back to 0.0.0 on a repo with no version tags', () => {
  assert.equal(formatVersion(highestStable([])), '0.0.0');
  assert.equal(formatVersion(highestStable(['nightly', 'v-broken'])), '0.0.0');
  assert.equal(nextVersion({ tags: [], bump: 'minor', channel: 'stable' }), '0.1.0');
});

test('applyBump zeroes the fields below it and drops any prerelease', () => {
  assert.equal(formatVersion(applyBump(v('1.4.1'), 'patch')), '1.4.2');
  assert.equal(formatVersion(applyBump(v('1.4.1'), 'minor')), '1.5.0');
  assert.equal(formatVersion(applyBump(v('1.4.1'), 'major')), '2.0.0');
  assert.equal(formatVersion(applyBump(v('1.3.1-dev.55'), 'patch')), '1.3.2');
});

/* ------------------------- the regressions themselves ------------------------- */

test('THE BUG: a dev build no longer bumps a stale branch-local base', () => {
  // What shipped: dev's package.json was frozen at 1.3.0 because the release commit only
  // ever lands on main, so a patch bump produced 1.3.1-dev.55 — one day after v1.4.1.
  const shipped = v('1.3.1-dev.55');
  const fixed = v(nextVersion({ tags: REAL_TAGS, bump: 'patch', channel: 'dev', runNumber: 55 }));
  assert.equal(formatVersion(fixed), '1.4.2-dev.55');
  assert.equal(compareVersions(shipped, v('1.4.1')), -1, 'the shipped tag really did regress');
  assert.equal(compareVersions(fixed, v('1.4.1')), 1);
});

test('THE BUG: a patch push after a feat push cannot fall back below it', () => {
  // v1.4.0-dev.47 then v1.3.1-dev.48, four hours later, because the bump type was read from
  // ONE push. Here the feat build's core survives as the floor even when a later push is
  // classified patch.
  const tags = REAL_TAGS.slice(0, REAL_TAGS.indexOf('v1.4.0-dev.47') + 1);
  const after = nextVersion({ tags, bump: 'patch', channel: 'dev', runNumber: 48 });
  assert.equal(after, '1.4.0-dev.48');
  assert.equal(compareVersions(v(after), v('1.4.0-dev.47')), 1);
});

test('a dev preview does not run away one minor per push', () => {
  // The reason the bump applies to the stable base and never to the floor. Bumping the floor
  // would take 1.5.0 to 1.6.0 on the next push, then 1.7.0 — a release per commit.
  let tags = [...REAL_TAGS];
  for (const run of [56, 57, 58]) {
    const next = nextVersion({ tags, bump: 'minor', channel: 'dev', runNumber: run });
    assert.equal(next, `1.5.0-dev.${run}`);
    tags = [...tags, `v${next}`];
  }
});

test('every consecutive run moves strictly forward, on both channels', () => {
  let tags = [...REAL_TAGS];
  let previous = v(nextVersion({ tags, bump: 'patch', channel: 'dev', runNumber: 56 }));
  tags = [...tags, `v${formatVersion(previous)}`];

  // A realistic mix: dev pushes of varying bump type, punctuated by stable releases.
  const runs = [
    { bump: 'patch', channel: 'dev', runNumber: 57 },
    { bump: 'minor', channel: 'dev', runNumber: 58 },
    { bump: 'minor', channel: 'stable' },
    { bump: 'patch', channel: 'dev', runNumber: 60 },
    { bump: 'patch', channel: 'stable' },
    { bump: 'major', channel: 'dev', runNumber: 62 },
    { bump: 'major', channel: 'stable' },
  ] as const;

  for (const r of runs) {
    const next = v(nextVersion({ tags, ...r }));
    assert.equal(
      compareVersions(next, previous),
      1,
      `${formatVersion(next)} must sort above ${formatVersion(previous)}`,
    );
    previous = next;
    tags = [...tags, `v${formatVersion(next)}`];
  }
});

test('a stable release outranks the dev build that previewed it', () => {
  const tags = [...REAL_TAGS, 'v1.5.0-dev.60'];
  // The floor carries the preview's core into the release rather than bumping past it, so
  // what ships stable is the number dev has been advertising.
  assert.equal(nextVersion({ tags, bump: 'patch', channel: 'stable' }), '1.5.0');
});

test('nextVersion REFUSES rather than publishing a number that sorts below a tag', () => {
  // The reachable case is a RUN NUMBER that goes backwards: re-running an older workflow run
  // replays its number, and the core alone cannot separate the two builds. A published tag
  // cannot be taken back, so this stops the pipeline instead.
  assert.throws(
    () =>
      nextVersion({
        tags: [...REAL_TAGS, 'v1.4.2-dev.99'],
        bump: 'patch',
        channel: 'dev',
        runNumber: 56,
      }),
    /does not sort above the existing tag v1\.4\.2-dev\.99/,
  );
});

test('the guard is unreachable on the stable channel, by construction', () => {
  // Worth pinning: `bumped` is always above the highest stable tag, and the floor only ever
  // raises it, so no stable release can land on or below an existing tag. If this ever starts
  // throwing, the base/floor arithmetic changed shape and the reasoning above went with it.
  let tags = [...REAL_TAGS, 'v1.5.0-dev.60'];
  for (const bump of ['patch', 'minor', 'major'] as const) {
    assert.doesNotThrow(() => nextVersion({ tags, bump, channel: 'stable' }));
  }
  tags = [...tags, 'v2.0.0'];
  assert.doesNotThrow(() => nextVersion({ tags, bump: 'patch', channel: 'stable' }));
});

test('a dev version needs a run number, and says so', () => {
  assert.throws(
    () => nextVersion({ tags: REAL_TAGS, bump: 'patch', channel: 'dev' }),
    /needs an integer runNumber/,
  );
});
