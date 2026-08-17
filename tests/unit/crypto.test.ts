import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, open, toBase64, fromBase64, type SealedBox } from '@/lib/crypto';

test('seal/open round-trips a secret under a password', async () => {
  const box = await seal('S3CR3T', 'hunter2');
  assert.equal(box.v, 1);
  const plain = await open(box, 'hunter2');
  assert.equal(plain, 'S3CR3T');
});

test('opening with the wrong password throws', async () => {
  const box = await seal('secret', 'correct');
  await assert.rejects(() => open(box, 'wrong'), /Contraseña incorrecta/);
});

test('each seal is fresh (unique salt + iv)', async () => {
  const a = await seal('same', 'pw');
  const b = await seal('same', 'pw');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  // and both still decrypt
  assert.equal(await open(a, 'pw'), 'same');
  assert.equal(await open(b, 'pw'), 'same');
});

test('a tampered ciphertext fails authentication', async () => {
  const box = await seal('payload', 'pw');
  const tampered: SealedBox = { ...box, data: box.data.slice(0, -2) + (box.data.endsWith('AA') ? 'BB' : 'AA') };
  await assert.rejects(() => open(tampered, 'pw'));
});

test('base64 helpers round-trip arbitrary bytes', () => {
  const bytes = new Uint8Array([0, 1, 2, 254, 255]);
  const b64 = toBase64(bytes);
  const back = fromBase64(b64);
  assert.deepEqual(Array.from(back), Array.from(bytes));
});

test('unicode plaintext survives the round-trip', async () => {
  const box = await seal('frase con ñ y emojis 🚀', 'pw');
  assert.equal(await open(box, 'pw'), 'frase con ñ y emojis 🚀');
});
