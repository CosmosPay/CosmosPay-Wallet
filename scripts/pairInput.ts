/**
 * What the user types at scripts/adb-pair.ts's prompts, turned into adb arguments.
 *
 * Split out because a prompt cannot be driven from node:test — and typing is now the route
 * that has to work when mDNS discovery does not, so it is the half of pairing that gets
 * used on exactly the machines where nothing else does. A wrong address here is not a
 * crash: `adb pair` just reports a refusal, which reads as a mistyped code.
 */

/** Address and code for `adb pair`. */
export type PairInput = { addr: string; code: string };

/**
 * Parse `"<IP:PORT> <CODE>"`, or `"<CODE>"` alone when discovery already found the address.
 *
 * Two tokens are the whole thing and need nothing discovered — that is the point of the
 * prompt. One token is only enough if `knownAddr` was announced on the network.
 */
export function parsePairInput(answer: string, knownAddr?: string): PairInput | { error: string } {
  const parts = answer.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { error: 'nothing typed.' };

  const [addr, code] = parts.length > 1 ? [parts[0], parts[1]] : [knownAddr, parts[0]];
  if (!addr) {
    return { error: 'that dialog shows an address above the code — type both, e.g. 192.168.1.50:41341 123456' };
  }
  // A bare host is the one shape that fails confusingly: adb would dial the default port
  // and time out somewhere unrelated to the pairing dialog the user is looking at.
  if (!/:\d+$/.test(addr)) return { error: `"${addr}" has no port — the dialog shows one, after the colon.` };
  if (!code) return { error: 'no code in that line.' };
  return { addr, code };
}

/**
 * The address for `adb connect`, from the "IP address & Port" on the Wireless debugging
 * screen. A bare port is accepted: the host is already fixed by the pairing that just
 * happened, so re-typing it can only introduce a typo.
 */
export function connectAddress(answer: string, host: string): string {
  const typed = answer.trim();
  return typed.includes(':') ? typed : `${host}:${typed}`;
}
