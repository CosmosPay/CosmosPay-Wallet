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
  nativeCredentialsApi,
  passkeyRpId,
  toBase64Url,
  webAuthnJson,
  type CredentialsApi,
  type NativeInvoke,
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
import { PASSKEY_PRF_BACKUP_LABEL, PASSKEY_PRF_UNLOCK_LABEL, PASSKEY_RP_ID } from '@/constants/passkey';

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

/* --------------------------- the native transport (the mobile app) --------------------------- */

/**
 * A phone, as the plugin presents it: WebAuthn JSON in, `PublicKeyCredentialJSON` out, PRF
 * computed like a provider would. What this pins is the TRANSPORT — that the ceremony the
 * web layer builds survives the trip as JSON the platforms read (buffers as base64url, the
 * salts where Credential Manager and `Passkey.swift` look for them), and that the reply is
 * read back into the same two secrets a browser would have produced.
 */
function fakePhone(opts: { reject?: { failure: string; detail?: string } } = {}) {
  const credentials = new Map<string, Uint8Array>();
  const requests: { command: string; json: Record<string, any> }[] = [];
  const b64 = (bytes: Uint8Array) => toBase64Url(bytes);
  const invoke: NativeInvoke = async <T,>(command: string, args: Record<string, unknown>): Promise<T> => {
    const json = JSON.parse((args.payload as { requestJson: string }).requestJson) as Record<string, any>;
    requests.push({ command, json });
    if (opts.reject) throw opts.reject;
    let id: Uint8Array;
    if (command === 'passkey_create') {
      id = crypto.getRandomValues(new Uint8Array(20));
      credentials.set(b64(id), id);
    } else {
      const allow: string[] = (json.allowCredentials ?? []).map((c: { id: string }) => c.id);
      const pick = allow.find((a) => credentials.has(a));
      if (!pick) throw { failure: 'stale', detail: 'no passkey for this site on the phone' };
      id = credentials.get(pick)!;
    }
    const ev = json.extensions?.prf?.eval;
    const out = (salt: string) => b64(new Uint8Array(prf(id, fromBase64Url(salt) as BufferSource)));
    return {
      responseJson: JSON.stringify({
        id: b64(id),
        rawId: b64(id),
        type: 'public-key',
        clientExtensionResults: { prf: { enabled: true, results: { first: out(ev.first), second: out(ev.second) } } },
      }),
    } as T;
  };
  return { invoke, requests };
}

test('buffers travel as base64url, and nothing undefined travels at all', () => {
  const json = webAuthnJson({ a: new Uint8Array([251, 255]), b: undefined, c: [{ id: new Uint8Array([1]).buffer }], d: 'x' });
  assert.deepEqual(json, { a: '-_8', c: [{ id: 'AQ' }], d: 'x' });
});

test('a ceremony over the native transport yields the same two secrets a browser would', async () => {
  const phone = fakePhone();
  const api = nativeCredentialsApi(phone.invoke);
  const created = await createPasskey(USER, api);
  const got = await getPasskeySecrets([created.credentialId], api);
  assert.deepEqual(got.backup, created.backup);
  assert.deepEqual(got.unlock, created.unlock);
  assert.notDeepEqual(created.backup, created.unlock);

  // The JSON the platforms read: the salts where Credential Manager and Passkey.swift look,
  // the user handle and challenge as base64url, the allow list naming the credential.
  const [c, g] = phone.requests;
  assert.equal(c.command, 'passkey_create');
  assert.match(c.json.user.id, /^[A-Za-z0-9_-]+$/);
  assert.match(c.json.challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(c.json.user.name, USER.name);
  assert.equal(c.json.authenticatorSelection.userVerification, 'required');
  const salt = (label: string) => toBase64Url(new Uint8Array(createHash('sha256').update(label).digest()));
  assert.equal(c.json.extensions.prf.eval.first, salt(PASSKEY_PRF_BACKUP_LABEL));
  assert.equal(c.json.extensions.prf.eval.second, salt(PASSKEY_PRF_UNLOCK_LABEL));
  assert.equal(g.command, 'passkey_get');
  assert.deepEqual(g.json.allowCredentials, [{ type: 'public-key', id: created.credentialId }]);
});

test('a native rejection keeps its meaning', async () => {
  const cases: [string, string][] = [
    ['cancelled', 'cancelled'],
    ['unsupported', 'unsupported'],
    ['noHardware', 'unsupported'],
    ['noPasscode', 'unsupported'],
    ['notEnrolled', 'unsupported'],
    ['stale', 'failed'],
    ['failed', 'failed'],
  ];
  for (const [failure, reason] of cases) {
    const api = nativeCredentialsApi(fakePhone({ reject: { failure, detail: 'x' } }).invoke);
    await assert.rejects(createPasskey(USER, api), (e: unknown) => e instanceof PasskeyError && e.reason === reason, failure);
  }
});

test('a phone whose provider has no PRF is noPrf, exactly as in a browser', async () => {
  const invoke: NativeInvoke = async <T,>() =>
    ({ responseJson: JSON.stringify({ id: 'AQID', rawId: 'AQID', type: 'public-key', clientExtensionResults: {} }) }) as T;
  await assert.rejects(createPasskey(USER, nativeCredentialsApi(invoke)), (e: unknown) => e instanceof PasskeyError && e.reason === 'noPrf');
});

test('a reply that is not a credential is a failure, not a crash', async () => {
  for (const out of [{}, { responseJson: 42 }, { responseJson: '{}' }]) {
    const invoke: NativeInvoke = async <T,>() => out as T;
    await assert.rejects(createPasskey(USER, nativeCredentialsApi(invoke)), (e: unknown) => e instanceof PasskeyError && e.reason === 'failed');
  }
});

test('the relying party is cosmospay.lat where the page is on it, and the page’s own host elsewhere', () => {
  const g = globalThis as { location?: unknown };
  const saved = g.location;
  try {
    for (const [host, rp] of [
      ['cosmospay.lat', PASSKEY_RP_ID],
      ['wallet.cosmospay.lat', PASSKEY_RP_ID],
      ['localhost', undefined],
      ['evilcosmospay.lat', undefined],
      ['cosmospay.lat.example.com', undefined],
    ] as const) {
      g.location = { hostname: host };
      assert.equal(passkeyRpId(), rp, host);
    }
  } finally {
    g.location = saved;
  }
});
