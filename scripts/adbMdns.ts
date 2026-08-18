/**
 * Parsing for `adb mdns services`.
 *
 * Kept apart from scripts/adb-pair.ts so it is reachable from node:test: the pairing flow
 * itself needs a phone in the room, and this is the part of it that breaks silently. A
 * mis-read line does not throw — it just never matches, so pairing waits its full three
 * minutes and then reports that nobody scanned the code.
 *
 * adb prints a header line and then one tab-separated row per service:
 *
 *   List of discovered mdns services
 *   adb-39041FDJH003AB-vWTUuJ	_adb-tls-pairing._tcp	192.168.1.50:41341
 */
export type MdnsService = {
  /** Instance name. For pairing it is whatever the QR asked for; afterwards, device-derived. */
  name: string;
  /** `_adb-tls-pairing._tcp` before pairing, `_adb-tls-connect._tcp` after it. */
  type: string;
  /** `host:port`, and the port differs between the two services of one device. */
  addr: string;
};

export function parseMdnsServices(output: string): MdnsService[] {
  return output
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    // Filtering on the service type rather than skipping line 0: the header is not always
    // the only noise on stdout, and a row that is not an _adb service is not ours anyway.
    .filter((f): f is [string, string, string] => f.length >= 3 && f[1].startsWith('_adb'))
    .map(([name, type, addr]) => ({ name, type, addr }));
}

/** The pairing service the phone announces after scanning a QR that named `service`. */
export function findPairing(services: MdnsService[], service: string): MdnsService | undefined {
  return services.find((s) => s.name === service && s.type.includes('pairing'));
}

/**
 * A phone offering to pair that is NOT answering our QR — i.e. one sitting on the
 * "Pair device with pairing code" screen, whose six digits have to be typed in.
 *
 * The only thing separating the two screens is the instance name: a phone that scanned our
 * code announces itself under the name the QR asked for, and one that did not announces
 * under a name derived from its serial. Matching too loosely here means prompting for a
 * code while the QR route is already mid-handshake with the same phone; `skip` keeps an
 * address that was already asked about from being asked again every poll.
 */
export function findOffered(
  services: MdnsService[],
  ownName: string,
  skip: ReadonlySet<string> = new Set(),
): MdnsService | undefined {
  return services.find(
    (s) => s.type.includes('pairing') && s.name !== ownName && !skip.has(s.addr),
  );
}

/**
 * The connect service of the device at `host`.
 *
 * Matched by host, not by name: a paired device announces itself under an instance name
 * derived from its serial, which the QR flow has no way to know in advance.
 */
export function findConnect(services: MdnsService[], host: string): MdnsService | undefined {
  return services.find((s) => s.type.includes('connect') && s.addr.startsWith(`${host}:`));
}
