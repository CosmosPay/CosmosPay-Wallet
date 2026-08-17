/**
 * Pair a phone with this machine over Wi-Fi — Android 11+ wireless debugging.
 *
 *   npm run pair:android
 *
 * On the phone: Settings → Developer options → Wireless debugging. Both of its pairing
 * screens work, and this waits for either at the same time as it waits for a USB cable.
 * `npm run dev:android` runs it when it finds no device.
 *
 * **Pair device with QR code.** The QR here carries `WIFI:T:ADB;S:<name>;P:<password>;;`,
 * the payload Android Studio emits. Scanning it makes the phone advertise
 * `_adb-tls-pairing._tcp` under <name>, which is how we recognise our own code being
 * answered, and the password we generated is what pairs with it. Nothing is typed.
 *
 * **Pair device with pairing code.** The phone shows an address and six digits; both are
 * typed at the prompt. That code is the phone's, so no host can know it in advance.
 *
 * The two routes race, because **the QR one can only work if inbound mDNS does**: scanning
 * tells the phone who to trust, not us where it is, so its port is learned from the
 * announcement or not at all. On Windows adb's firewall rule is routinely scoped to
 * "Public" while the network in use is "Private", and discovery then fails silently —
 * indistinguishable, from the terminal, from a phone that was never scanned. Typing needs
 * no discovery in either phase: `adb pair` and `adb connect` dial *out*.
 *
 * Both routes end at `adb pair <addr> <code>`, then a connect to the second service the
 * paired device announces — on a different port, which the Wireless debugging screen also
 * shows. adb 34+ ships its own mDNS stack (Openscreen), so no Bonjour install is involved.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface, type Interface } from 'node:readline/promises';
import QRCode from 'qrcode';
import { findConnect, findOffered, findPairing, parseMdnsServices } from './adbMdns.ts';
import { adbPath } from './androidSdk.ts';
import { connectAddress, parsePairInput } from './pairInput.ts';

// How long to leave the QR on screen, and how long to wait for the paired device to come
// back as a connectable one. Pairing is a human walking to their phone; connecting is one
// more announcement, or one more line typed.
const PAIR_TIMEOUT_MS = 180_000;
const CONNECT_TIMEOUT_MS = 120_000;
const POLL_MS = 1000;
// Discovery that has not produced a single service by now is not slow, it is blocked.
const DISCOVERY_SUSPECT_MS = 20_000;

const TAG = '\x1b[36madb-pair\x1b[0m';
const log = (msg: string) => console.log(`${TAG} ${msg}`);
function fail(msg: string): never {
  console.error(`\x1b[31madb-pair\x1b[0m ${msg}`);
  process.exit(1);
}

const found = await adbPath();
if (!found) {
  fail('adb not found — install "Android SDK Platform-Tools" from Android Studio\'s SDK Manager.');
}
// Re-bound after the check: `adb()` below is a hoisted declaration, and TypeScript will not
// carry the narrowing into a function that could, as far as it knows, run before it.
const ADB: string = found;

/** Run adb and hand back everything it said; adb reports failures in its output, not its code. */
function adb(args: string[]): Promise<string> {
  return new Promise((done) => {
    let out = '';
    const child = spawn(ADB, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => (out += c));
    child.stderr.on('data', (c: string) => (out += c));
    child.on('error', () => done(''));
    child.on('exit', () => done(out));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Devices adb would actually deploy to.
 *
 * `unauthorized` (the RSA prompt is still on screen) and `offline` are deliberately not
 * matched: counting them ends the wait on a phone that cannot receive an APK yet.
 */
async function connectedDevice(): Promise<string | undefined> {
  const out = await adb(['devices']);
  return out.split('\n').slice(1).find((l) => /\sdevice\s*$/.test(l))?.split(/\s+/)[0];
}

const mdnsServices = async () => parseMdnsServices(await adb(['mdns', 'services']));

/** How a wait ended. `connected` is terminal; `paired` still needs the connect phase. */
type Outcome = { kind: 'connected'; serial: string } | { kind: 'paired'; host: string };
type Waiter = (signal: AbortSignal) => Promise<Outcome | undefined>;

/** Resolves undefined when the race is called off — a waiter with nothing to wait on. */
const untilAborted = (signal: AbortSignal): Promise<undefined> =>
  new Promise((done) => signal.addEventListener('abort', () => done(undefined), { once: true }));

/**
 * First waiter to succeed wins; the others are aborted.
 *
 * Every waiter returns undefined only on abort, so a plain `Promise.race` cannot settle
 * early on a waiter that simply has no work — which matters, because the typing one is
 * inert without a TTY and would otherwise end the race for everybody.
 */
async function race(timeoutMs: number, waiters: Waiter[]): Promise<Outcome | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race(waiters.map((w) => w(controller.signal)));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Read one line, or undefined once the race is over. */
async function ask(rl: Interface, query: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    return await rl.question(`${TAG} ${query}`, { signal });
  } catch {
    return undefined; // aborted
  }
}

/** A prompt loop, or an inert waiter when nothing can be typed into this process. */
async function prompt(
  signal: AbortSignal,
  query: string,
  attempt: (answer: string) => Promise<Outcome | string>,
): Promise<Outcome | undefined> {
  if (!process.stdin.isTTY) return untilAborted(signal);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (!signal.aborted) {
      const answer = await ask(rl, query, signal);
      if (answer === undefined) return undefined;
      if (!answer.trim()) continue;
      const result = await attempt(answer.trim());
      if (typeof result !== 'string') return result;
      log(result);
    }
    return undefined;
  } finally {
    rl.close();
  }
}

// The service name ties the QR to the announcement the phone makes after scanning it, so it
// has to be unique per run; the password is what proves to the phone that the host asking to
// pair is the one whose screen it just photographed. Both come from the CSPRNG — `;` is the
// payload's field separator, and hex cannot produce one.
const NAME = `cosmos-${randomBytes(4).toString('hex')}`;
const PASSWORD = randomBytes(6).toString('hex');

/** Address of a pairing service seen on the network, offered as the prompt's default. */
let seenPairingAddr: string | undefined;

/** Watch for a scanned QR, a phone on the pairing-code screen, or a USB cable. */
const pairByDiscovery: Waiter = async (signal) => {
  const started = Date.now();
  let sawAnything = false;
  let warned = false;

  while (!signal.aborted) {
    const serial = await connectedDevice();
    if (serial) return { kind: 'connected', serial };

    const services = await mdnsServices();
    sawAnything ||= services.length > 0;

    const scanned = findPairing(services, NAME);
    if (scanned) {
      log(`the QR was scanned — pairing with ${scanned.addr}…`);
      const result = await adb(['pair', scanned.addr, PASSWORD]);
      if (/successfully paired/i.test(result)) return { kind: 'paired', host: scanned.addr.split(':')[0] };
      // Our own generated password being rejected is not a user mistake to retry: it means
      // this announcement is not an answer to the QR we printed.
      fail(`pairing was refused: ${result.trim() || 'no output from adb'}`);
    }

    // A phone on the pairing-code screen announces the same service under a name derived
    // from its serial. We cannot pair with it unattended — that code is only on its screen —
    // but knowing the address means the prompt needs the six digits alone.
    seenPairingAddr = findOffered(services, NAME)?.addr ?? seenPairingAddr;

    if (!warned && !sawAnything && Date.now() - started > DISCOVERY_SUSPECT_MS) {
      warned = true;
      log('\x1b[33mno mDNS service has appeared at all — discovery looks blocked.\x1b[0m');
      log('the QR route needs it; typing below does not. On Windows, check that adb.exe has an');
      log('inbound firewall rule for the profile your network is in (usually Private, not Public).');
    }

    await sleep(POLL_MS);
  }
  return undefined;
};

/** Pair from what the phone's "Pair device with pairing code" dialog is showing. */
const pairByTyping: Waiter = (signal) =>
  prompt(signal, '"Pair device with pairing code" → type "<IP:PORT> <CODE>": ', async (answer) => {
    const input = parsePairInput(answer, seenPairingAddr);
    if ('error' in input) return input.error;

    const result = await adb(['pair', input.addr, input.code]);
    if (/successfully paired/i.test(result)) return { kind: 'paired', host: input.addr.split(':')[0] };
    // Mistyped digits are the likeliest cause, and Android regenerates that code every time
    // the dialog opens — so let it be tried again instead of giving up.
    return `not accepted: ${result.trim() || 'no output from adb'}`;
  });

/** Connect to the second service a paired device announces, at the address it paired from. */
const connectByDiscovery = (host: string): Waiter => async (signal) => {
  while (!signal.aborted) {
    const serial = await connectedDevice();
    if (serial) return { kind: 'connected', serial };

    const service = findConnect(await mdnsServices(), host);
    if (service) await adb(['connect', service.addr]);

    await sleep(POLL_MS);
  }
  return undefined;
};

/** Connect from the "IP address & Port" the Wireless debugging screen shows. */
const connectByTyping = (host: string): Waiter => (signal) =>
  prompt(signal, `"IP address & Port" on the Wireless debugging screen (${host}:____): `, async (answer) => {
    const addr = connectAddress(answer, host);
    const result = await adb(['connect', addr]);
    if (/^connected to/im.test(result)) return { kind: 'connected', serial: addr };
    return `could not connect: ${result.trim() || 'no output from adb'}`;
  });

// ---------------------------------------------------------------------------------------

await adb(['start-server']);

if (await connectedDevice()) {
  log('a device is already connected — nothing to pair.');
  process.exit(0);
}

console.log(await QRCode.toString(`WIFI:T:ADB;S:${NAME};P:${PASSWORD};;`, { type: 'terminal', small: true }));
log('on the phone: Settings → Developer options → Wireless debugging, then either');
log('  · "Pair device with QR code"      → scan the code above and wait');
log('  · "Pair device with pairing code" → type what it shows at the prompt below');
log(`code carried by the QR: \x1b[1m${PASSWORD}\x1b[0m — the camera reads it, there is nothing to type`);
log(`a USB cable ends the wait too. Giving up in ${PAIR_TIMEOUT_MS / 1000}s.`);

const pairing = await race(PAIR_TIMEOUT_MS, [pairByDiscovery, pairByTyping]);

if (!pairing) {
  fail(
    'nothing paired in time.\n' +
      '  - Typing works even when discovery does not: re-run and enter "<IP:PORT> <CODE>" from\n' +
      '    the phone\'s "Pair device with pairing code" dialog.\n' +
      '  - The QR route additionally needs inbound mDNS to reach adb.exe.',
  );
}

if (pairing.kind === 'connected') {
  log(`device connected: ${pairing.serial}`);
  process.exit(0);
}

// Paired is not connected: the phone announces a second service, on a different port, once
// it trusts us — the port the Wireless debugging screen itself displays.
log(`paired with ${pairing.host}. Waiting for it to come back online…`);
const connected = await race(CONNECT_TIMEOUT_MS, [
  connectByDiscovery(pairing.host),
  connectByTyping(pairing.host),
]);

if (!connected) {
  fail(
    `paired with ${pairing.host}, but it never came back online.\n` +
      '  The pairing is remembered, so the QR is not needed again — re-run and type the\n' +
      '  "IP address & Port" from the Wireless debugging screen when asked.',
  );
}

log(`device connected: ${connected.kind === 'connected' ? connected.serial : pairing.host}`);
process.exit(0);
