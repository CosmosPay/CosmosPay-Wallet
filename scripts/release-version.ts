/**
 * The next version to release — derived from the TAGS, never from package.json.
 *
 * package.json was the source of truth and that is what produced published releases going
 * BACKWARDS: v1.4.1 on 2026-08-24, then v1.3.1-dev.55 on 2026-08-25. Two independent causes,
 * and each one alone is enough to regress a version.
 *
 *  1. THE BASE WAS BRANCH-LOCAL. `main` commits its bump back (`chore(release)`); `dev`
 *     deliberately does not, because a dev prerelease is ephemeral. So dev's package.json
 *     froze at 1.3.0 while main moved to 1.4.1, and every dev run bumped that stale 1.3.0.
 *
 *  2. THE BUMP TYPE WAS COMPUTED OVER ONE PUSH. `before..after` is a single push, so a push
 *     carrying a `feat:` chose minor and the next push carrying only fixes chose patch — off
 *     the same frozen base. That is v1.4.0-dev.47 followed by v1.3.1-dev.48, four hours later.
 *
 * Tags are the only record that both branches share and that nothing rewrites, so they are
 * what this derives from:
 *
 *   base   the highest STABLE tag (vX.Y.Z, no prerelease). The bump applies to this.
 *   bump   read from every commit since that tag, not from one push, so once a `feat:`
 *          lands the minor bump stays chosen until it is released.
 *   floor  the highest core among ALL tags, prereleases included. The bump result is
 *          raised to it when it would land lower — history rewrites and hand-made tags
 *          are the cases the cumulative range above cannot see.
 *
 * The bump is applied to `base` and never to `floor`: bumping the floor would minor-bump
 * 1.5.0 into 1.6.0 on the next dev push, then 1.7.0, and run away one release per push.
 *
 * Monotonicity is then ASSERTED rather than assumed — `nextVersion` throws if what it built
 * is not strictly greater than every existing tag. A release that cannot go forward should
 * stop the pipeline, not publish a number that sorts below one already out there.
 *
 * Used by .github/workflows/release-extension.yml. Pure functions live here so
 * tests/unit/releaseVersion.test.ts can cover the arithmetic without a git checkout.
 */

import { pathToFileURL } from 'node:url';

export type Bump = 'major' | 'minor' | 'patch';
export type Channel = 'stable' | 'dev';

export type Version = {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers, already split. Empty for a stable version. */
  pre: (string | number)[];
};

/**
 * Accepts an optional leading `v`, because that is how the tags are written and stripping it
 * at every call site is how one of them eventually forgets.
 *
 * Build metadata (`+sha`) is rejected rather than ignored: nothing here produces it, and
 * accepting it would mean deciding how it compares — semver says it does not participate in
 * precedence at all, which makes two "different" versions equal and a monotonicity check
 * meaningless.
 */
export function parseVersion(input: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(input.trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

export function formatVersion(v: Version): string {
  const core = `${v.major}.${v.minor}.${v.patch}`;
  return v.pre.length ? `${core}-${v.pre.join('.')}` : core;
}

/** -1, 0 or 1 — semver precedence, including the prerelease rules. */
export function compareVersions(a: Version, b: Version): number {
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  // A version WITHOUT a prerelease outranks the same core with one: 1.4.0 > 1.4.0-dev.51.
  // This is the rule that makes a dev tag a preview of a release rather than a successor to
  // it, and getting it backwards would let `-dev.N` sort above the release it previewed.
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1;
  if (!b.pre.length) return -1;

  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    // A shorter set of identifiers loses, so dev.5 < dev.5.1.
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    // Numeric identifiers compare numerically and always rank below alphanumeric ones.
    const xNum = typeof x === 'number';
    const yNum = typeof y === 'number';
    if (xNum && yNum) return x < y ? -1 : 1;
    if (xNum !== yNum) return xNum ? -1 : 1;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

const ZERO: Version = { major: 0, minor: 0, patch: 0, pre: [] };

/** Every tag this repo can parse. Anything else is ignored rather than throwing: a repo may
 *  carry tags that were never versions, and one of them must not stop a release. */
function parseTags(tags: readonly string[]): Version[] {
  return tags.map((t) => parseVersion(t)).filter((v): v is Version => v !== null);
}

/** The highest tag with no prerelease — what a bump is applied to. */
export function highestStable(tags: readonly string[]): Version {
  return parseTags(tags)
    .filter((v) => !v.pre.length)
    .reduce((best, v) => (compareVersions(v, best) > 0 ? v : best), ZERO);
}

/** The highest core across all tags, prereleases included — the floor a result is raised to. */
export function highestCore(tags: readonly string[]): Version {
  return parseTags(tags)
    .map((v) => ({ ...v, pre: [] }))
    .reduce((best, v) => (compareVersions(v, best) > 0 ? v : best), ZERO);
}

export function applyBump(v: Version, bump: Bump): Version {
  if (bump === 'major') return { major: v.major + 1, minor: 0, patch: 0, pre: [] };
  if (bump === 'minor') return { major: v.major, minor: v.minor + 1, patch: 0, pre: [] };
  return { major: v.major, minor: v.minor, patch: v.patch + 1, pre: [] };
}

export type NextVersionOptions = {
  /** Every tag in the repo, in any order, with or without the `v` prefix. */
  tags: readonly string[];
  bump: Bump;
  channel: Channel;
  /** The workflow run number. Monotonic per workflow, which is what orders two dev tags
   *  sharing a core. Required for `dev`, ignored for `stable`. */
  runNumber?: number;
};

export function nextVersion({ tags, bump, channel, runNumber }: NextVersionOptions): string {
  const bumped = applyBump(highestStable(tags), bump);
  const floor = highestCore(tags);
  const core = compareVersions(bumped, floor) < 0 ? floor : bumped;

  let next: Version;
  if (channel === 'dev') {
    if (typeof runNumber !== 'number' || !Number.isInteger(runNumber) || runNumber < 0) {
      throw new Error(`a dev version needs an integer runNumber, got ${String(runNumber)}`);
    }
    next = { ...core, pre: ['dev', runNumber] };
  } else {
    next = core;
  }

  // ASSERT, don't assume. Everything above is designed to move forward, and a published
  // version that sorts below an existing one cannot be taken back — the tag, the GitHub
  // Release and every downloaded installer are already out there. Cheap to check, and the
  // failure it prevents is the one this whole module exists for.
  const behind = parseTags(tags).filter((t) => compareVersions(next, t) <= 0);
  if (behind.length) {
    const worst = behind.reduce((a, b) => (compareVersions(a, b) > 0 ? a : b));
    throw new Error(
      `refusing to release ${formatVersion(next)}: it does not sort above the existing tag ` +
        `v${formatVersion(worst)}. Base was v${formatVersion(highestStable(tags))} with a ` +
        `${bump} bump, floor v${formatVersion(floor)}.`,
    );
  }
  return formatVersion(next);
}

/* ------------------------------------ cli ------------------------------------
   `node scripts/release-version.ts <bump> <channel> [runNumber]`, reading the tag list on
   stdin (one per line) so the caller owns the `git tag` invocation and this stays pure.
   Prints the version and nothing else, so a workflow can capture it with $(...). */

// pathToFileURL, not a string comparison on argv[1]: the two spell the same file differently
// on Windows (backslashes, drive letter case), and a loose match would run the CLI when the
// unit test merely imports this module — where it would then block forever on an empty stdin.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [bump, channel, run] = process.argv.slice(2);
  const valid = bump === 'major' || bump === 'minor' || bump === 'patch';
  if (!valid || (channel !== 'stable' && channel !== 'dev')) {
    console.error('usage: release-version.ts <major|minor|patch> <stable|dev> [runNumber] < tags');
    process.exit(2);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const tags = Buffer.concat(chunks).toString('utf8').split('\n').map((t) => t.trim()).filter(Boolean);
  try {
    process.stdout.write(
      nextVersion({ tags, bump, channel, runNumber: run === undefined ? undefined : Number(run) }),
    );
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  }
}
