/**
 * Build the wallet and run it on a phone (or emulator), from the device's own files.
 *
 *   npm run dev:android                        # build -> install -> launch. No server.
 *   npm run dev:ios                            # same, from macOS
 *   npm run dev:android -- --no-build          # redeploy the bundle already in dist/web/
 *   npm run dev:android -- --list              # list attached devices/emulators, then quit
 *   npm run dev:android -- --no-pair           # fail instead of offering the QR pairing
 *
 * With no device attached it runs scripts/adb-pair.ts, which prints a wireless-debugging
 * QR and waits — so a phone that has never been plugged in can still be deployed to.
 *
 * **The app runs offline, off the APK.** `cap sync` copies dist/web/ into the native project
 * and the WebView loads it from there; nothing is fetched from this machine at runtime. That
 * is how the app actually ships, so it is also the only way to see what it really does — and
 * it is the mode that works, full stop: a WebView pointed at a dev server has failed here
 * twice, once on the firewall (black screen) and once on the Capacitor bridge not resolving
 * across a remote origin, which hangs the boot screen forever because storage.ts awaits
 * @capacitor/preferences with no timeout.
 *
 * The cost is honest: a change means another build + install, not a hot reload. Live reload
 * is still available behind `--live` (see LIVE below) for when the trade is worth it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { access, readFile, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { androidSdkDir } from './androidSdk.ts';

const ROOT = process.cwd();
// Spawn the package entry points with this Node, never the .bin shims: `astro.cmd`
// and `cap.cmd` need a shell on Windows, and a shell child cannot be killed by pid.
const ASTRO_BIN = join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs');
const CAP_BIN = join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
const PAIR_SCRIPT = join(ROOT, 'scripts', 'adb-pair.ts');
// Capacitor's own installer, reached directly — see deployAndroid for why `cap run` is not.
const NATIVE_RUN_BIN = join(ROOT, 'node_modules', 'native-run', 'bin', 'native-run');

const argv = process.argv.slice(2);
const has = (name: string) => argv.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const PLATFORM = argv.find((a) => a === 'android' || a === 'ios') ?? 'android';

/**
 * Opt in to live reload: the WebView loads the Astro dev server instead of the APK's files.
 *
 *   -- --live              through adb (`adb reverse`), no LAN and no firewall involved
 *   -- --live --lan        directly at http://<LAN-IP>:PORT
 *   -- --live --host <ip>  the same, with the address pinned
 *   -- --live --no-serve   `npm run dev` is already running in another terminal
 *
 * Off by default because both of its transports have failed on a stock Windows box, and
 * neither failure says what it is: the LAN one needs an inbound rule for node.exe on the
 * profile the network is actually in (Windows writes them for "Public"; a home network is
 * "Private") and shows a black screen; the adb one loads the page but leaves the Capacitor
 * bridge unable to answer, and the boot screen waits on @capacitor/preferences forever.
 * When it does work it is worth having — HMR and the /api + /cosmos-api dev proxies.
 */
const LIVE = has('live');
const REVERSE = LIVE && PLATFORM === 'android' && !has('lan') && !opt('host');
const SERVE = !has('no-serve');
// The bundle is what runs now, so a stale one is a wrong answer rather than a slow one.
const BUILD = !LIVE && !has('no-build');

const log = (msg: string) => console.log(`\x1b[36mcap-dev\x1b[0m ${msg}`);
// A declaration, not a `const` arrow: TypeScript only narrows on a never-returning call
// when the callee has an explicit return type it can see at the declaration site, which
// is what lets `if (!HOST) fail(…)` leave HOST a plain string below.
function fail(msg: string): never {
  console.error(`\x1b[31mcap-dev\x1b[0m ${msg}`);
  process.exit(1);
}

/** Repo-relative unless the path is already absolute — `resolve` handles both. */
async function exists(p: string): Promise<boolean> {
  try {
    await access(resolve(ROOT, p));
    return true;
  } catch {
    return false;
  }
}

/**
 * The dev port, read from astro.config.ts rather than duplicated here — a second
 * literal is a blank screen on the phone the day someone changes the first one.
 * The `[^}]*` cannot cross a brace, so this only ever matches the top-level
 * `server: { port: N }` block, not the nested `vite.server` one.
 */
async function devPort(): Promise<number> {
  const cfg = await readFile(join(ROOT, 'astro.config.ts'), 'utf8');
  return Number(cfg.match(/server:\s*\{[^}]*\bport:\s*(\d+)/)?.[1]) || 4500;
}

/**
 * The address of the interface this machine actually routes out of — i.e. the one on
 * the same network as the phone.
 *
 * A "connected" UDP socket sends nothing; it only makes the kernel resolve the route
 * and bind a local address, which is then readable. No packet leaves the machine, and
 * 8.8.8.8 is a routing landmark here, not a destination. Returns undefined when there
 * is no route at all (offline), leaving the ranked guess below to take over.
 */
function routedAddress(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const done = (address?: string) => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(address && address !== '0.0.0.0' ? address : undefined);
    };
    socket.once('error', () => done());
    try {
      socket.connect(53, '8.8.8.8', () => done(socket.address().address));
    } catch {
      done();
    }
  });
}

/**
 * Reachable IPv4 addresses of this machine, best candidate first.
 *
 * The fallback for when routing tells us nothing, and the list printed as alternatives.
 * Capacitor's own `--live-reload` default takes whatever interface the OS lists first,
 * which on a Windows dev box is routinely a WSL/Hyper-V/VirtualBox adapter the phone
 * cannot route to. Rank by RFC1918 block and push virtual adapters to the back, then
 * print the rest so `--host` is an obvious fix rather than a guess.
 */
function lanAddresses(): { name: string; address: string }[] {
  const virtual = /virtual|vethernet|vmware|vbox|docker|wsl|hyper-v|tailscale|zerotier|loopback/i;
  const rank = (name: string, address: string) => {
    let score = /^192\.168\./.test(address) ? 3
      : /^10\./.test(address) ? 2
      : /^172\.(1[6-9]|2\d|3[01])\./.test(address) ? 1
      : 0;
    if (virtual.test(name)) score -= 5;
    return score;
  };

  return Object.entries(networkInterfaces())
    .flatMap(([name, infos]) => (infos ?? []).map((i) => ({ name, ...i })))
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => ({ name: i.name, address: i.address, score: rank(i.name, i.address) }))
    .sort((a, b) => b.score - a.score)
    .map(({ name, address }) => ({ name, address }));
}

/** True when something is already accepting connections on host:port. */
function probe(host: string, port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * Run a node entry point to completion, sharing this terminal.
 *
 * `process.execArgv` is forwarded so a `.ts` child gets the same --experimental-strip-types
 * this script was started with; the .js entry points ignore it.
 */
function run(bin: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<number> {
  return new Promise((done) => {
    spawn(process.execPath, [...process.execArgv, bin, ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
      .on('error', (err) => fail(`could not start ${bin}: ${err.message}`))
      .on('exit', (code) => done(code ?? 1));
  });
}

/**
 * Run a native executable to completion in `cwd`, sharing this terminal.
 *
 * An argument array, never a command line — so nothing is re-parsed on the way in. The one
 * exception is a Windows batch file: since the CVE-2024-27980 fix, Node refuses to spawn
 * `.bat`/`.cmd` without a shell at all (`EINVAL`), and cmd.exe is the only thing that can
 * interpret one. Safe here because every caller passes literals defined in this file; do not
 * start routing user input through it.
 */
function runNative(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<number> {
  const batch = process.platform === 'win32' && /\.(bat|cmd)$/i.test(bin);
  return new Promise((done) => {
    spawn(bin, args, { cwd, stdio: 'inherit', shell: batch, env: { ...process.env, ...env } })
      .on('error', (err) => fail(`could not start ${bin}: ${err.message}`))
      .on('exit', (code) => done(code ?? 1));
  });
}

/** One row of `cap run <platform> --list --json`. */
type CapTarget = { id?: string; name?: string; api?: string };

/**
 * Sync, build and install — the three steps `cap run android` performs, run directly.
 *
 * `cap run android` is not usable on Windows: it shells out to `./gradlew`, which cmd
 * cannot execute ("gradlew no se reconoce como un comando"), and there is no flag for it.
 * Doing the steps here also means the live-reload URL is written where we can see it, and
 * that a build failure stops before anything is installed.
 */
async function deployAndroid(): Promise<number> {
  // Sync first: it copies dist/web/ into the project and fires the capacitor:sync:after
  // hook that restores resources/android/ (the launcher icon).
  const synced = await run(CAP_BIN, ['sync', 'android'], CHILD_ENV);
  if (synced !== 0) return synced;

  if (LIVE) {
    // What `--live-reload` did, minus the bookkeeping: point the WebView at the dev server
    // by editing the copy of the config that gets packaged. No revert is needed — the next
    // sync regenerates this file from capacitor.config.ts, so the setting cannot outlive
    // the run that asked for it.
    const nativeConfig = join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'capacitor.config.json');
    const config = JSON.parse(await readFile(nativeConfig, 'utf8')) as Record<string, unknown>;
    // cleartext because the URL is plain http on a private address, which Android blocks
    // by default since API 28.
    config.server = { ...(config.server as object), url: `http://${HOST}:${PORT}`, cleartext: true };
    await writeFile(nativeConfig, JSON.stringify(config, null, 2));
    log(`native config points at http://${HOST}:${PORT} for this build`);
  }

  // Explicitly relative: cmd.exe resolves a bare name against PATH, not against the cwd we
  // just handed it, and would report the wrapper sitting right there as "not recognised".
  const gradlew = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
  const built = await runNative(gradlew, ['assembleDebug'], join(ROOT, 'android'), CHILD_ENV);
  if (built !== 0) return built;

  const apk = join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const args = ['android', '--app', apk, '--target', TARGET_ID];
  // `--forward <device:host>` is `adb reverse`, so the device's localhost is this machine's.
  if (REVERSE) args.push('--forward', `${PORT}:${PORT}`);
  return run(NATIVE_RUN_BIN, args, CHILD_ENV);
}

/** macOS has no equivalent problem, so iOS keeps using Capacitor's own runner. */
function deployIos(): Promise<number> {
  const args = ['run', 'ios'];
  if (LIVE) args.push('--live-reload', '--host', HOST, '--port', String(PORT));
  if (opt('target')) args.push('--target', opt('target') as string);
  return run(CAP_BIN, args, CHILD_ENV);
}

/**
 * Kill a child and everything it spawned. Astro's dev server forks workers, so killing
 * the pid alone leaves the port bound and the next run silently reuses a stale server.
 */
function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/**
 * The devices and emulators Capacitor could deploy to.
 *
 * Asked BEFORE anything is started. Without it, a machine with nothing attached boots a
 * dev server, syncs the whole bundle into android/, and only then prints Capacitor's bare
 * `No devices found.` before tearing it all down again — a 30-second round trip that never
 * says what to plug in. `--list --json` puts the array on stdout and its chatter on stderr,
 * so stderr stays inherited: a broken SDK has to keep reporting itself.
 */
function capTargets(): Promise<CapTarget[]> {
  return new Promise((done) => {
    let out = '';
    const child = spawn(process.execPath, [CAP_BIN, 'run', PLATFORM, '--list', '--json'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, ...CHILD_ENV },
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (out += chunk));
    child.on('error', () => done([]));
    child.on('exit', () => {
      try {
        const json = out.match(/\[[\s\S]*\]/)?.[0];
        done(json ? JSON.parse(json) : []);
      } catch {
        done([]);
      }
    });
  });
}

/**
 * Stop the dev server we started — both ways it can be running.
 *
 * Astro 7 daemonizes `astro dev` whenever it is passed `--background` OR it auto-detects
 * an AI-agent shell, and the process we spawned is then only a launcher that exits as
 * soon as the real server is up. Killing its pid leaves port 4500 held by an orphan, and
 * the next run happily "reuses" that stale server. `astro dev stop` is what reaches the
 * daemon; it is a no-op when the server ran in the foreground, so do both, in that order.
 */
async function stopDevServer(child: ChildProcess) {
  stopping = true;
  killTree(child);
  await new Promise<void>((resolve) => {
    spawn(process.execPath, [ASTRO_BIN, 'dev', 'stop'], { cwd: ROOT, stdio: 'ignore' })
      .on('error', () => resolve())
      .on('exit', () => resolve());
  });
}

// ---------------------------------------------------------------- preflight

if (has('lan') && opt('host')) {
  fail('--lan and --host say the same thing; pass one.');
}

// The platform packages are devDependencies (they ship no JS into the bundle — only
// Gradle and Xcode read them), so `npm install` brings them. The generated native project
// is gitignored, so every clone has to add it once.
if (!(await exists(`node_modules/@capacitor/${PLATFORM}`))) {
  fail(`@capacitor/${PLATFORM} is missing — run \`npm install\` (it is a devDependency).`);
}
if (!(await exists(PLATFORM))) {
  fail(
    `no ${PLATFORM}/ project yet — it is generated, not committed. Once per clone:\n` +
      `    npx cap add ${PLATFORM}\n` +
      (PLATFORM === 'android'
        ? '  Needs the Android Studio SDK (Android 36 + platform-tools) and a JDK 17+.'
        : '  Needs macOS with Xcode.'),
  );
}

// Gradle and native-run both need the SDK; neither is told where it is by default.
const SDK = PLATFORM === 'android' ? androidSdkDir() : undefined;
if (PLATFORM === 'android' && !(SDK && (await exists(SDK)))) {
  fail(
    'Android SDK not found. Install it from Android Studio (SDK Manager → Android 36 + platform-tools),\n' +
      '  or point ANDROID_HOME at an existing one.',
  );
}
const CHILD_ENV: NodeJS.ProcessEnv = SDK ? { ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK } : {};

const PORT = await devPort();

if (has('list')) {
  process.exit(await run(CAP_BIN, ['run', PLATFORM, '--list'], CHILD_ENV));
}

let targets = await capTargets();
if (!targets.length) {
  // Nothing to deploy to. On Android that is recoverable without touching the machine:
  // offer the wireless-debugging QR and wait. Only give up if the pairing gives up too.
  if (PLATFORM === 'android' && !has('no-pair')) {
    log('no device or emulator found — starting Wi-Fi pairing.');
    await run(PAIR_SCRIPT, [], CHILD_ENV);
  }

  targets = await capTargets();
  if (!targets.length) {
    fail(
      `no ${PLATFORM === 'android' ? 'Android device or emulator' : 'iOS device or simulator'} to deploy to.\n` +
        (PLATFORM === 'android'
          ? '  Wi-Fi: `npm run pair:android` and scan the QR (Developer options → Wireless debugging).\n' +
            '  Cable: enable USB debugging, plug it in, accept the RSA prompt on screen.\n' +
            '  Emulator: create one in Android Studio → Device Manager, start it, then re-run.\n'
          : '  Device: plug it in and trust this Mac.  Simulator: open one from Xcode.\n') +
        `  \`npm run dev:${PLATFORM} -- --list\` shows what Capacitor can see.`,
    );
  }
}

// Naming the target explicitly rather than letting native-run take the first one: with a
// phone and an emulator both up, "the first one" is whichever adb happened to list first.
const chosen = opt('target') ? targets.find((t) => t.id === opt('target')) : targets[0];
if (!chosen?.id) {
  fail(`no target matching --target ${opt('target')}. \`npm run dev:${PLATFORM} -- --list\` shows the ids.`);
}
const TARGET_ID: string = chosen.id;
if (targets.length > 1) log(`${targets.length} targets available; using ${chosen.name ?? TARGET_ID} (--target picks another)`);

// After the device check, not before: a full build is a slow way to find out there is
// nothing to install it on.
//
// dist/web/ IS the app here — `cap sync` copies it into the native project and the WebView
// loads it from disk. Under --live it is only the fallback for an unreachable dev server, so
// it is enough that one exists; without --live a stale one means shipping yesterday's code
// to the phone and wondering why the fix is not in it.
if (BUILD) {
  log('building dist/web/ — this is what the phone will run…');
  const code = await run(ASTRO_BIN, ['build']);
  if (code !== 0) fail('astro build failed.');
} else if (!(await exists('dist/web/index.html'))) {
  if (!LIVE) fail('no dist/web/ to deploy — drop --no-build, or run `npm run build` first.');
  log('dist/web/ is empty — building once so Capacitor has something to sync…');
  const code = await run(ASTRO_BIN, ['build']);
  if (code !== 0) fail('astro build failed.');
}

// ---------------------------------------------------------------- dev server

let devServer: ChildProcess | undefined;
// Set before we take the dev server down on purpose: taskkill /F reports exit code 1,
// which is indistinguishable from a crash unless we remember that we asked for it.
let stopping = false;
let HOST = '';

if (LIVE) {
  const candidates = lanAddresses();
  HOST = (REVERSE ? 'localhost' : opt('host') ?? (await routedAddress()) ?? candidates[0]?.address) ?? '';
  if (!HOST) {
    fail('no external IPv4 address found — connect to Wi-Fi, or pass --host <ip>.');
  }

  if (SERVE && (await probe('127.0.0.1', PORT))) {
    log(`port ${PORT} is already answering — reusing that dev server.`);
  } else if (SERVE) {
    log(`starting astro dev on 0.0.0.0:${PORT}…`);
    devServer = spawn(process.execPath, [ASTRO_BIN, 'dev', '--host'], {
      cwd: ROOT,
      stdio: 'inherit',
      // POSIX: own process group, so killTree can take the workers down with it.
      detached: process.platform !== 'win32',
    });
    devServer.on('error', (err) => fail(`could not start astro dev: ${err.message}`));
    devServer.on('exit', (code) => {
      if (!stopping && code) fail(`astro dev exited with code ${code}.`);
    });

    const deadline = Date.now() + 60_000;
    while (!(await probe('127.0.0.1', PORT))) {
      if (Date.now() > deadline) {
        await stopDevServer(devServer);
        fail(`astro dev never started listening on ${PORT}.`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  log(
    REVERSE
      ? `WebView will load http://localhost:${PORT}, tunnelled here over adb (add --lan for the direct route)`
      : `WebView will load http://${HOST}:${PORT}`,
  );

  if (!REVERSE) {
    // Reaching our own LAN address proves the server is bound to 0.0.0.0 rather than to
    // loopback — the difference between `astro dev --host` and plain `astro dev`, and the
    // one that turns a reused (or --no-serve) dev server into a blank WebView with no error
    // on either side. It says nothing about the firewall; only the phone can prove that.
    if (!(await probe(HOST, PORT))) {
      log(`warning: ${HOST}:${PORT} does not answer from this machine — the dev server is probably bound to localhost only (start it with \`npm run dev\`, which passes --host).`);
    }

    const others = candidates.filter((c) => c.address !== HOST);
    if (others.length) {
      log(`other addresses here: ${others.map((c) => `${c.address} (${c.name})`).join(', ')}`);
      log('if the app stays blank, the phone is on another network — retry with --host <ip>.');
    }
    if (process.platform === 'win32') {
      log('Windows: node.exe needs an INBOUND firewall rule on the profile this network is in.');
      log('Its rules are commonly "Public" only while a home network is "Private", which shows up');
      log('as a black screen and nothing else. Dropping --lan avoids the question entirely.');
    }
  }
} else {
  log('the phone will run the bundle off its own storage — no server, no network.');
}

// ---------------------------------------------------------------- deploy

// Under --live the deploy leaves a server URL in the native config; `cap run` used to
// restore it on SIGINT, so let the child own the signal rather than dying mid-install.
process.on('SIGINT', () => {});

const code = PLATFORM === 'android' ? await deployAndroid() : await deployIos();

if (devServer) {
  log('stopping the dev server…');
  await stopDevServer(devServer);
}
process.exit(code);
