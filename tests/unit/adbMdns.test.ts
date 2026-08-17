/**
 * The QR pairing flow reads adb's service list, and nothing else in the repo can check it.
 *
 * `npm run pair:android` cannot be exercised without a phone in the room, and its one
 * fragile step — turning `adb mdns services` text into an address to pair with — fails
 * silently when it fails: a row that does not parse simply never matches, so pairing waits
 * out its three-minute timeout and blames the user for not scanning the code.
 *
 * The samples below are adb 36's real output shape: a header line, then tab-separated
 * rows of instance name, service type and host:port.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConnect, findOffered, findPairing, parseMdnsServices } from '../../scripts/adbMdns.ts';

const PAIRING = [
  'List of discovered mdns services',
  'cosmos-9f3a1c7d\t_adb-tls-pairing._tcp\t192.168.1.50:41341',
  '',
].join('\n');

const AFTER_PAIRING = [
  'List of discovered mdns services',
  'cosmos-9f3a1c7d\t_adb-tls-pairing._tcp\t192.168.1.50:41341',
  'adb-39041FDJH003AB-vWTUuJ\t_adb-tls-connect._tcp\t192.168.1.50:37199',
  '',
].join('\n');

test('parses a service row, and drops the header', () => {
  assert.deepEqual(parseMdnsServices(PAIRING), [
    { name: 'cosmos-9f3a1c7d', type: '_adb-tls-pairing._tcp', addr: '192.168.1.50:41341' },
  ]);
});

test('an empty list parses to nothing rather than throwing', () => {
  assert.deepEqual(parseMdnsServices('List of discovered mdns services\n\n'), []);
  assert.deepEqual(parseMdnsServices(''), []);
});

test('finds the pairing service by the name the QR carried', () => {
  assert.equal(findPairing(parseMdnsServices(PAIRING), 'cosmos-9f3a1c7d')?.addr, '192.168.1.50:41341');
  // A stale announcement from someone else's run must not be paired with: the password we
  // generated is not the one in their QR, and adb would report a refusal we cannot explain.
  assert.equal(findPairing(parseMdnsServices(PAIRING), 'cosmos-deadbeef'), undefined);
});

test('a phone answering our QR is never mistaken for one showing a pairing code', () => {
  // This is the whole distinction between the two screens. Treating our own announcement as
  // an "offer" would stop to ask for six digits that only exist on the other screen, while
  // the QR handshake it belongs to is already in flight.
  assert.equal(findOffered(parseMdnsServices(PAIRING), 'cosmos-9f3a1c7d'), undefined);
});

test('a phone on the pairing-code screen is offered, once per address', () => {
  const services = parseMdnsServices(PAIRING);
  // Same rows, but this run printed a different QR — so that announcement is somebody's
  // pairing-code screen, not an answer to us.
  const offered = findOffered(services, 'cosmos-deadbeef');
  assert.equal(offered?.addr, '192.168.1.50:41341');
  assert.equal(findOffered(services, 'cosmos-deadbeef', new Set([offered!.addr])), undefined);
});

test('the connect service is not mistaken for something to pair with', () => {
  // After pairing, both services are announced. Offering the connect one would send a
  // pairing code to a port that is not listening for one.
  assert.equal(findOffered(parseMdnsServices(AFTER_PAIRING), 'cosmos-9f3a1c7d'), undefined);
});

test('finds the connect service by host, never by name', () => {
  const services = parseMdnsServices(AFTER_PAIRING);
  // Same device, different port from the pairing service — connecting to the pairing port
  // is the mistake matching on anything but the type would make.
  assert.equal(findConnect(services, '192.168.1.50')?.addr, '192.168.1.50:37199');
  assert.equal(findConnect(services, '192.168.1.51'), undefined);
});

test('a host is matched whole, so .5 never answers for .50', () => {
  const services = parseMdnsServices(AFTER_PAIRING);
  assert.equal(findConnect(services, '192.168.1.5'), undefined);
});
