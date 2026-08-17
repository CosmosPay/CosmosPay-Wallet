/**
 * The typed pairing route is the one that works when mDNS discovery does not, so it runs on
 * exactly the machines where nothing else does — and a prompt cannot be driven from here.
 *
 * These are the shapes a person actually types off the phone's screen. A wrong address does
 * not throw: `adb pair` reports a refusal, which reads as a mistyped code and sends the user
 * back to re-read six digits that were right all along.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectAddress, parsePairInput } from '../../scripts/pairInput.ts';

test('address and code on one line need nothing discovered', () => {
  assert.deepEqual(parsePairInput('192.168.1.50:41341 123456'), {
    addr: '192.168.1.50:41341',
    code: '123456',
  });
  // Copied off a screen, so extra spacing is the normal case, not the odd one.
  assert.deepEqual(parsePairInput('  192.168.1.50:41341    123456  '), {
    addr: '192.168.1.50:41341',
    code: '123456',
  });
});

test('a code alone is accepted only when discovery supplied the address', () => {
  assert.deepEqual(parsePairInput('123456', '192.168.1.50:41341'), {
    addr: '192.168.1.50:41341',
    code: '123456',
  });
  assert.ok('error' in parsePairInput('123456'));
});

test('an address without a port is refused, not passed to adb', () => {
  // The failure this prevents: adb dials its default port, times out, and blames a code the
  // user then re-types correctly several times.
  const result = parsePairInput('192.168.1.50 123456');
  assert.ok('error' in result && result.error.includes('no port'));
});

test('an empty line is an error, never a pairing attempt', () => {
  assert.ok('error' in parsePairInput(''));
  assert.ok('error' in parsePairInput('   '));
});

test('the connect address takes a bare port, and a full one unchanged', () => {
  assert.equal(connectAddress('37199', '192.168.1.50'), '192.168.1.50:37199');
  assert.equal(connectAddress(' 192.168.1.50:37199 ', '192.168.1.50'), '192.168.1.50:37199');
  // A phone that moved networks between pairing and connecting: what was typed wins over
  // the host we paired at, because the typed line is the one being read off the screen now.
  assert.equal(connectAddress('192.168.1.77:37199', '192.168.1.50'), '192.168.1.77:37199');
});
