/**
 * Passkeys as a place to keep a secret (src/lib/passkey.ts, src/lib/passkeyUnlock.ts).
 *
 * A real authenticator needs a person, so the ceremonies run against a fake
 * `CredentialsApi` that behaves like one: it answers PRF with a deterministic function of
 * (credential, salt), which is the one property the wallet relies on. What is pinned:
 *
 *  - both secrets come from ONE ceremony, and they differ (two salts, two doors);
 *  - a dismissed sheet is `cancelled`, an authenticator without PRF is `noPrf` — the two
 *    outcomes a screen answers differently (silence versus "use a password");
 *  - the device door round-trips the device password, and refuses any other passkey as
 *    stale rather than as a wrong password.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  PasskeyError,
  createPasskey,
  fromBase64Url,
  getPasskeySecrets,
  toBase64Url,
  type CredentialsApi,
} from '@/lib/passkey';
import {
  PasskeyUnlockStaleError,
  devicePasswordFrom,
  dropPasskeyUnlock,
  enrolPasskeyUnlock,
  newDevicePassword,
  parsePasskeyEnvelope,
  passkeyUnlockCredential,
  unlockWithPasskey,
} from '@/lib/passkeyUnlock';
import { PASSKEY_PRF_BACKUP_LABEL, PASSKEY_PRF_UNLOCK_LABEL } from '@/constants/passkey';

// `passkeyPossible()` needs WebAuthn to exist; node has none, so the suite provides the
// two globals it checks. The fake below is what actually answers.
(globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential ??= function PublicKeyCredential() {};
Object.defineProperty(globalThis.navigator, 'credentials', { value: {}, configurable: true });

const view = (src: BufferSource): Uint8Array =>
  src instanceof ArrayBuffer ? new Uint8Array(src) : new Uint8Array(src.buffer, src.byteOffset, src.byteLength);

/** PRF as an authenticator computes it: a keyed hash no one outside can reproduce. */
function prf(credential: Uint8Array, salt: BufferSource): ArrayBuffer {
  const out = createHash('sha256').update(credential).update(view(salt)).digest();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

type PrfMode = 'eval' | 'enabled' | 'none';
type Ext = { prf?: { eval?: { first: BufferSource; second?: BufferSource } } } | undefined;

interface FakeOpts {
  /** 'eval' answers PRF at creation, 'enabled' only reports support, 'none' has no PRF. */
  createPrf?: PrfMode;
  reject?: string;
}

function fakeAuthenticator(opts: FakeOpts = {}) {
  const credentials = new Map<string, Uint8Array>();
  const calls = { create: 0, get: [] as string[][] };

  const answer = (id: Uint8Array, ext: Ext, mode: PrfMode) =>
    ({
      id: toBase64Url(id),
      rawId: id.buffer.slice(id.byteOffset, id.byteOffset + id.byteLength),
      type: 'public-key',
      getClientExtensionResults: () => {
        if (mode === 'none') return {};
        if (mode === 'enabled') return { prf: { enabled: true } };
        const ev = ext?.prf?.eval;
        if (!ev) return { prf: { enabled: true } };
        return {
          prf: { enabled: true, results: { first: prf(id, ev.first), second: ev.second && prf(id, ev.second) } },
        };
      },
    }) as unknown as Credential;

  const api: CredentialsApi = {
    async create(o) {
      calls.create += 1;
      if (opts.reject) throw Object.assign(new Error(opts.reject), { name: opts.reject });
      const id = crypto.getRandomValues(new Uint8Array(16));
      credentials.set(toBase64Url(id), id);
      return answer(id, o.publicKey?.extensions as Ext, opts.createPrf ?? 'eval');
    },
    async get(o) {
      const allow = (o.publicKey?.allowCredentials ?? []).map((c) => toBase64Url(view(c.id)));
      calls.get.push(allow);
      if (opts.reject) throw Object.assign(new Error(opts.reject), { name: opts.reject });
      const pick = allow.length ? allow.find((a) => credentials.has(a)) : [...credentials.keys()][0];
      if (!pick) throw Object.assign(new Error('no match'), { name: 'NotAllowedError' });
      return answer(credentials.get(pick)!, o.publicKey?.extensions as Ext, opts.createPrf === 'none' ? 'none' : 'eval');
    },
  };
  return { api, calls };
}

const USER = { name: 'ada@example.com', displayName: 'Ada' };

beforeEach(async () => {
  await dropPasskeyUnlock();
});

test('base64url round-trips a credential id', () => {
  const raw = crypto.getRandomValues(new Uint8Array(40));
  const s = toBase64Url(raw);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(fromBase64Url(s), raw);
});

test('one ceremony yields both secrets, and they differ', async () => {
  const { api, calls } = fakeAuthenticator();
  const s = await createPasskey(USER, api);
  assert.equal(s.backup.length, 32);
  assert.equal(s.unlock.length, 32);
  assert.notDeepEqual(s.backup, s.unlock);
  assert.equal(calls.create, 1);
  assert.equal(calls.get.length, 0);

  // The same credential answers the same secrets later — that is what makes it a key.
  const again = await getPasskeySecrets([s.credentialId], api);
  assert.deepEqual(again.backup, s.backup);
  assert.deepEqual(again.unlock, s.unlock);
});

test('the salts are the pinned labels, hashed — a change here strands every door', async () => {
  const { api } = fakeAuthenticator();
  const s = await createPasskey(USER, api);
  const id = fromBase64Url(s.credentialId);
  const salt = (label: string) => new Uint8Array(createHash('sha256').update(label).digest());
  assert.deepEqual(s.backup, new Uint8Array(prf(id, salt(PASSKEY_PRF_BACKUP_LABEL))));
  assert.deepEqual(s.unlock, new Uint8Array(prf(id, salt(PASSKEY_PRF_UNLOCK_LABEL))));
});

test('an authenticator that only reports PRF at creation is asked once more, for that credential', async () => {
  const { api, calls } = fakeAuthenticator({ createPrf: 'enabled' });
  const s = await createPasskey(USER, api);
  assert.equal(calls.get.length, 1);
  assert.deepEqual(calls.get[0], [s.credentialId]);
});

test('an authenticator without PRF is noPrf, so the screen can offer a password', async () => {
  const { api } = fakeAuthenticator({ createPrf: 'none' });
  await assert.rejects(createPasskey(USER, api), (e: unknown) => e instanceof PasskeyError && e.reason === 'noPrf');
});

test('a dismissed sheet is cancelled, never a failure', async () => {
  const { api } = fakeAuthenticator({ reject: 'NotAllowedError' });
  await assert.rejects(createPasskey(USER, api), (e: unknown) => e instanceof PasskeyError && e.reason === 'cancelled');
  await assert.rejects(getPasskeySecrets([], api), (e: unknown) => e instanceof PasskeyError && e.reason === 'cancelled');
});

test('the device door round-trips the device password and asks only for its own passkey', async () => {
  const { api, calls } = fakeAuthenticator();
  const s = await createPasskey(USER, api);
  const pwd = newDevicePassword();
  assert.equal(Buffer.from(pwd, 'base64').length, 32);

  await enrolPasskeyUnlock(s, pwd);
  assert.equal(await passkeyUnlockCredential(), s.credentialId);
  assert.equal(await devicePasswordFrom(s), pwd);

  const opened = await unlockWithPasskey(api);
  assert.equal(opened.password, pwd);
  assert.deepEqual(calls.get.at(-1), [s.credentialId]);
  // The same ceremony carries the backup secret, so re-sealing the backup costs no second sheet.
  assert.deepEqual(opened.secrets.backup, s.backup);
});

test('another passkey is stale for this device, not a wrong password', async () => {
  const { api } = fakeAuthenticator();
  const mine = await createPasskey(USER, api);
  const other = await createPasskey(USER, api);
  await enrolPasskeyUnlock(mine, newDevicePassword());
  await assert.rejects(devicePasswordFrom(other), PasskeyUnlockStaleError);
  // Right id, wrong secret — a forged or corrupted answer.
  await assert.rejects(devicePasswordFrom({ ...mine, unlock: new Uint8Array(32).fill(1) }), PasskeyUnlockStaleError);
});

test('no envelope means no door, and dropping it closes the door', async () => {
  assert.equal(await passkeyUnlockCredential(), null);
  const { api } = fakeAuthenticator();
  await assert.rejects(unlockWithPasskey(api), PasskeyUnlockStaleError);
  const s = await createPasskey(USER, api);
  await enrolPasskeyUnlock(s, newDevicePassword());
  await dropPasskeyUnlock();
  assert.equal(await passkeyUnlockCredential(), null);
});

test('an envelope this build does not write reads as no envelope', () => {
  for (const raw of [null, '', 'nope', '{}', '{"v":2,"id":"x","box":{}}', '{"v":1,"id":"","box":{}}', '{"v":1,"id":"x"}']) {
    assert.equal(parsePasskeyEnvelope(raw), null);
  }
});
