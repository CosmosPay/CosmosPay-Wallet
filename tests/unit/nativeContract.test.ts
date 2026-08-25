/**
 * The wallet's own native plugin speaks one vocabulary in four languages.
 *
 * A `Failure` token leaves Kotlin or Swift as the `code` on a rejection, is parsed back
 * into a Rust enum by `src-tauri/plugins/cosmos/src/error.rs`, is re-serialised, and is
 * finally matched against a TypeScript union in `src/lib/deviceAuth.ts`. Nothing in any
 * toolchain checks that those four lists agree — Rust cannot see the Kotlin, TypeScript
 * cannot see either, and the Swift half is compiled only on a Mac.
 *
 * The failure is silent and it is the worst kind. Rename one variant and every build still
 * compiles; what changes is that a dismissed Face ID prompt stops arriving as `cancelled`
 * and starts arriving as `failed`, so a user who tapped "cancel" to type their password
 * instead meets a red error line. `deviceAuthFailure()` is written to fail closed, so the
 * drift never announces itself — it just quietly reclassifies everything it no longer
 * recognises.
 *
 * This is the cheapest check that catches it: read the four files as text and compare the
 * sets. It cannot prove the halves BEHAVE the same, only that they are talking about the
 * same things — a floor, like tests/unit/paths.test.ts, not a proof.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const PLUGIN = join(ROOT, 'src-tauri', 'plugins', 'cosmos');

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8');

const TS_DEVICE_AUTH = read(ROOT, 'src', 'lib', 'deviceAuth.ts');
const TS_BRIDGE = read(ROOT, 'src', 'lib', 'nativeBridge.ts');
const RS_MODELS = read(PLUGIN, 'src', 'models.rs');
const RS_COMMANDS = read(PLUGIN, 'src', 'commands.rs');
const RS_MOBILE = read(PLUGIN, 'src', 'mobile.rs');
const RS_BUILD = read(PLUGIN, 'build.rs');
const TOML_PERMISSIONS = read(PLUGIN, 'permissions', 'default.toml');
const KT_CONTRACT = read(PLUGIN, 'android', 'src', 'main', 'java', 'lat', 'cosmospay', 'plugin', 'cosmos', 'Contract.kt');
const KT_PLUGIN = read(PLUGIN, 'android', 'src', 'main', 'java', 'lat', 'cosmospay', 'plugin', 'cosmos', 'CosmosPlugin.kt');
const SWIFT_CONTRACT = read(PLUGIN, 'ios', 'Sources', 'CosmosPlugin', 'Contract.swift');
const SWIFT_PLUGIN = read(PLUGIN, 'ios', 'Sources', 'CosmosPlugin', 'CosmosPlugin.swift');

/* ----------------------------- tiny source readers ----------------------------- */

/**
 * The body of the delimited block that follows `header`.
 *
 * Delimiter COUNTING rather than a lazy regex, because every one of these blocks carries
 * doc comments and several nest. A `[^}]*` would stop at the first inner delimiter and
 * return half a list — which, in a test that compares lists, reads as a deleted variant.
 *
 * The scan starts AFTER the header rather than at it, and that is not a detail: Rust spells
 * the command table `const COMMANDS: &[&str] = &[…]`, so the first `[` in the vicinity
 * belongs to the TYPE. Starting at the header would return `&str`.
 */
function blockAfter(source: string, header: string, open = '{', close = '}'): string {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `block not found: ${header}`);
  const from = source.indexOf(open, start + header.length);
  assert.notEqual(from, -1, `block never opens: ${header}`);
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0) return source.slice(from + 1, i);
  }
  throw new Error(`unterminated block: ${header}`);
}

/** The right-hand side of a TypeScript type alias: everything up to its semicolon. */
function aliasAfter(source: string, header: string): string {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `type alias not found: ${header}`);
  const end = source.indexOf(';', start);
  assert.notEqual(end, -1, `type alias never ends: ${header}`);
  return source.slice(start, end);
}

/** Strip line comments so a token named in prose is never mistaken for a declaration. */
const uncommented = (block: string) =>
  block
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');

const all = (block: string, re: RegExp): string[] => [...uncommented(block).matchAll(re)].map((m) => m[1]);

/** `NoStrongBiometry` -> `noStrongBiometry`, which is what `#[serde(rename_all)]` emits. */
const camel = (pascal: string) => pascal[0].toLowerCase() + pascal.slice(1);

/** Compare as SORTED lists, not as sets: the diff a failure prints is then readable. */
const sorted = (xs: string[]) => [...new Set(xs)].sort();

/* --------------------------------- failures --------------------------------- */

const tsFailures = () =>
  sorted(all(blockAfter(TS_DEVICE_AUTH, 'const FAILURES: readonly DeviceAuthFailure[] =', '[', ']'), /'([a-zA-Z]+)'/g));

const rustFailures = () => sorted(all(blockAfter(RS_MODELS, 'pub enum Failure'), /^\s*([A-Z][A-Za-z]*),/gm).map(camel));

const kotlinFailures = () => sorted(all(blockAfter(KT_CONTRACT, 'internal enum class Failure'), /\("([a-zA-Z]+)"\)/g));

const swiftFailures = () => sorted(all(blockAfter(SWIFT_CONTRACT, 'enum Failure: String'), /^\s*case ([a-zA-Z]+)\s*$/gm));

test('every failure token is spelled the same in all four languages', () => {
  const ts = tsFailures();
  assert.ok(ts.length >= 8, `the TypeScript list looks unparsed (${ts.length} entries)`);
  assert.deepEqual(rustFailures(), ts, 'Rust models.rs disagrees with TypeScript');
  assert.deepEqual(kotlinFailures(), ts, 'Kotlin Contract.kt disagrees with TypeScript');
  assert.deepEqual(swiftFailures(), ts, 'Swift Contract.swift disagrees with TypeScript');
});

/* --------------------------------- biometry --------------------------------- */

test('every biometry token is spelled the same in all four languages', () => {
  const ts = sorted(all(blockAfter(TS_DEVICE_AUTH, 'const KINDS: readonly DeviceAuthKind[] =', '[', ']'), /'([a-zA-Z]+)'/g));
  assert.ok(ts.length >= 5, `the TypeScript list looks unparsed (${ts.length} entries)`);

  const rust = sorted(all(blockAfter(RS_MODELS, 'pub enum Biometry'), /^\s*([A-Z][A-Za-z]*),/gm).map(camel));
  const kotlin = sorted(all(blockAfter(KT_CONTRACT, 'internal object Biometry'), /=\s*"([a-zA-Z]+)"/g));
  const swift = sorted(all(blockAfter(SWIFT_CONTRACT, 'enum Biometry: String'), /^\s*case ([a-zA-Z]+)\s*$/gm));

  assert.deepEqual(rust, ts, 'Rust models.rs disagrees with TypeScript');
  assert.deepEqual(kotlin, ts, 'Kotlin Contract.kt disagrees with TypeScript');
  assert.deepEqual(swift, ts, 'Swift Contract.swift disagrees with TypeScript');
});

/* --------------------------------- commands --------------------------------- */

/**
 * A command has to appear in four places to be callable, and three of the four fail
 * quietly. Missing from `build.rs` there is no `allow-` permission to grant, so the IPC
 * layer refuses it; missing from `default.toml` the permission exists but nothing grants
 * it; missing from `invoke_handler` it is simply unknown. All three surface on a device as
 * the same unhelpful rejection, which reads as a broken install rather than a missing line.
 */
const COMMAND_RE = /'([a-z_]+)'/g;

test('every command the frontend can name is declared, permitted and handled', () => {
  const ts = sorted(all(aliasAfter(TS_BRIDGE, 'export type NativeCommand'), COMMAND_RE));
  assert.ok(ts.length >= 5, `the NativeCommand union looks unparsed (${ts.length} entries)`);

  const declared = sorted(all(blockAfter(RS_BUILD, 'const COMMANDS: &[&str] =', '[', ']'), /"([a-z_]+)"/g));
  assert.deepEqual(declared, ts, 'build.rs COMMANDS disagrees with the NativeCommand union');

  // `allow-auth-status` is what `tauri-plugin`'s build script generates from `auth_status`.
  const permitted = sorted(
    [...TOML_PERMISSIONS.matchAll(/"allow-([a-z-]+)"/g)].map((m) => m[1].replaceAll('-', '_')),
  );
  assert.deepEqual(permitted, ts, 'permissions/default.toml does not grant exactly the declared commands');

  const handled = sorted(all(RS_COMMANDS, /pub\(crate\) async fn ([a-z_]+)</g));
  assert.deepEqual(handled, ts, 'commands.rs does not implement exactly the declared commands');
});

/* ------------------------------ mobile bridge ------------------------------ */

/**
 * The name Rust asks the mobile side for is a STRING, and it is camelCase where the Tauri
 * command is snake_case. Nothing checks it: `run_mobile_plugin("authRaed", …)` compiles,
 * and fails on a phone with "unknown command" — on the unlock screen, in front of a user.
 */
test('every mobile call has a method on both platforms to answer it', () => {
  const asked = sorted(all(RS_MOBILE, /run_mobile_plugin\("([a-zA-Z]+)"/g));
  assert.ok(asked.length >= 5, `mobile.rs looks unparsed (${asked.length} calls)`);

  const kotlin = sorted(all(KT_PLUGIN, /@Command\s*\n\s*fun ([a-zA-Z]+)\(/g));
  const swift = sorted(all(SWIFT_PLUGIN, /@objc public func ([a-zA-Z]+)\(/g));

  assert.deepEqual(kotlin, asked, 'the Kotlin plugin does not answer exactly what mobile.rs asks for');
  assert.deepEqual(swift, asked, 'the Swift plugin does not answer exactly what mobile.rs asks for');
});

/* -------------------------------- the events -------------------------------- */

test('the back-button event name matches on both sides', () => {
  const [, kotlin] = KT_PLUGIN.match(/const val BACK_PRESSED = "([a-zA-Z:]+)"/) ?? [];
  assert.ok(kotlin, 'CosmosPlugin.kt no longer declares BACK_PRESSED');
  const ts = sorted(all(aliasAfter(TS_BRIDGE, 'export type NativeEvent'), /'([a-zA-Z]+:[a-zA-Z]+)'/g));
  assert.deepEqual(ts, [kotlin], 'NativeEvent and the Kotlin trigger disagree');
});
