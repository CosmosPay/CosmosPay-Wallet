/**
 * Easy recovery (src/lib/easyRecovery.ts): the QR it reads, the code it draws, and the seal
 * that only the device that made the QR can open.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EasyRecoveryError,
  encodeLink,
  isEasyRecoveryCode,
  newCode,
  newReceiver,
  openPayload,
  parseLink,
  sealPayload,
  toB64url,
  type EasyRecoveryPayload,
} from '@/lib/easyRecovery';

const ID = toB64url(new Uint8Array(16).fill(7));
const PAYLOAD: EasyRecoveryPayload = { v: 1, kind: 'mnemonic', value: 'abandon '.repeat(11) + 'about', name: 'Ada' };

test('a QR reads back as the session and key it was made from', () => {
  const r = newReceiver();
  const link = { id: ID, key: r.publicKey };
  assert.deepEqual(parseLink(encodeLink(link)), link);
  assert.deepEqual(parseLink(`  ${encodeLink(link)}\n`), link);
});

test('anything that is not an easy-recovery QR of this version is refused', () => {
  const r = newReceiver();
  assert.equal(parseLink('web+stellar:pay?destination=G…'), null);
  assert.equal(parseLink(encodeLink({ id: ID, key: r.publicKey }).replace(':v1?', ':v2?')), null);
  assert.equal(parseLink(encodeLink({ id: ID.slice(1), key: r.publicKey })), null);
  assert.equal(parseLink(encodeLink({ id: ID, key: r.publicKey.slice(1) })), null);
  assert.equal(parseLink(encodeLink({ id: ID, key: r.publicKey.replace(/.$/, '+') })), null);
  // No server address in the QR: a QR that names one is not ours.
  assert.deepEqual(parseLink(encodeLink({ id: ID, key: r.publicKey }) + '&r=https://evil.example'), { id: ID, key: r.publicKey });
});

test('the device that made the QR opens the payload', async () => {
  const r = newReceiver();
  const sealed = await sealPayload(PAYLOAD, { id: ID, key: r.publicKey });
  assert.deepEqual(await openPayload(sealed, r.secret, ID), PAYLOAD);
});

test('no other device opens it, nor the same one for another session', async () => {
  const r = newReceiver();
  const other = newReceiver();
  const sealed = await sealPayload(PAYLOAD, { id: ID, key: r.publicKey });
  await assert.rejects(openPayload(sealed, other.secret, ID), EasyRecoveryError);
  await assert.rejects(openPayload(sealed, r.secret, toB64url(new Uint8Array(16).fill(8))), EasyRecoveryError);
});

test('a payload changed in transit does not open', async () => {
  const r = newReceiver();
  const sealed = await sealPayload(PAYLOAD, { id: ID, key: r.publicKey });
  const flipped = sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.at(-1);
  await assert.rejects(openPayload(flipped, r.secret, ID), EasyRecoveryError);
  await assert.rejects(openPayload('not base64!', r.secret, ID), EasyRecoveryError);
});

test('each seal is fresh: the same payload never seals the same way twice', async () => {
  const r = newReceiver();
  const link = { id: ID, key: r.publicKey };
  assert.notEqual(await sealPayload(PAYLOAD, link), await sealPayload(PAYLOAD, link));
});

test('codes are five digits, and the draw is not biased toward low codes', () => {
  for (let i = 0; i < 200; i++) assert.ok(isEasyRecoveryCode(newCode()));
  // A draw past the last whole multiple of 10^5 is redrawn rather than wrapped.
  let calls = 0;
  const draws = [0xffff_ffff, 123];
  const code = newCode((out) => {
    out[0] = draws[calls++];
    return out;
  });
  assert.equal(code, '00123');
  assert.equal(calls, 2);
  assert.ok(!isEasyRecoveryCode('1234'));
  assert.ok(!isEasyRecoveryCode('12a45'));
});

test('a low-order key is refused before anything is sealed to it', async () => {
  // Sealing to a low-order X25519 point yields a shared secret anyone can compute — the
  // server included. The community server refuses such keys on create; the sender must too.
  const zero = toB64url(new Uint8Array(32));
  const one = toB64url(new Uint8Array(32).map((_, i) => (i === 0 ? 1 : 0)));
  for (const key of [zero, one]) await assert.rejects(sealPayload(PAYLOAD, { id: ID, key }));
});
