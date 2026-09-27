/**
 * Passkeys, as the wallet uses them: not to log in anywhere, but to hold a secret.
 *
 * WebAuthn's PRF extension is what makes that possible. The authenticator — the phone's
 * secure element, Windows Hello, iCloud Keychain, a security key — mixes a salt the wallet
 * picks with a secret that never leaves it and hands back 32 bytes, the same 32 bytes every
 * time for that credential and salt. Nobody holding the wallet's files, the server's table
 * or the network traffic can compute them; only a person who passes the authenticator's own
 * check can make it produce them again. That is what lets a passkey stand where a password
 * stood.
 *
 * TWO SALTS, ONE PROMPT. Every ceremony asks for both outputs at once (`first` and `second`):
 * the BACKUP secret opens the box the community server keeps (`lib/cloudBackup.ts`), the
 * UNLOCK secret opens this device's vault (`lib/passkeyUnlock.ts`). They are independent —
 * the device door leaking tells nobody anything about the backup door — and asking for both
 * together is what keeps "restore on a new device" at one fingerprint instead of two.
 *
 * WHAT THIS FILE DOES NOT DECIDE. Whether a passkey is worth offering is `passkeyPossible()`
 * plus the result of trying: there is no API that answers "will this authenticator do PRF"
 * before a credential exists on every browser, so a creation that comes back without PRF
 * fails as `noPrf` and the caller falls back to a password.
 *
 * ONE RELYING PARTY: `cosmospay.lat` (`PASSKEY_RP_ID`). The web build uses it whenever it is
 * served from that domain or a subdomain, and the mobile app always does — so ONE synced
 * passkey opens the wallet in a browser and in the app alike. Anywhere else (localhost, a
 * preview host, the extension's own origin) the page's host is the relying party, as
 * WebAuthn requires; those passkeys are that host's alone.
 *
 * THE MOBILE APP HAS NO WEBAUTHN of its own — the Tauri WebView on Android and iOS does not
 * expose it — so there the same ceremonies go through the wallet's native plugin
 * (`nativeCredentialsApi` below): standard WebAuthn JSON over the bridge, Android's Credential
 * Manager and iOS's `ASAuthorization` on the other side. Everything above the transport — the
 * salts, the two secrets, the classification — is the same code on every build.
 *
 * Every failure is a `PasskeyError` with a `reason`, never a message to match on: a
 * dismissed sheet (`cancelled`) is the person's choice and gets no red line.
 */
import {
  PASSKEY_PRF_BACKUP_LABEL,
  PASSKEY_PRF_UNLOCK_LABEL,
  PASSKEY_RP_ID,
  PASSKEY_RP_NAME,
  PASSKEY_SECRET_BYTES,
  PASSKEY_TIMEOUT_MS,
  PASSKEY_USER_ID_BYTES,
} from '@/constants/passkey';
import { nativeInvoke } from '@/lib/nativeBridge';
import { isMobileApp, isTauri } from '@/lib/platform';

export type PasskeyFailure = 'cancelled' | 'unsupported' | 'noPrf' | 'failed';

/**
 * A passkey ceremony that did not produce secrets.
 *
 * English message, like `lib/crypto.ts`: it is for whoever reads a stack trace. Screens
 * branch on `reason` and render their own translated line.
 */
export class PasskeyError extends Error {
  readonly reason: PasskeyFailure;

  // A plain field rather than a parameter property: `node:test` runs this file in
  // strip-only mode, which cannot emit one.
  constructor(reason: PasskeyFailure, message: string = reason) {
    super(message);
    this.name = 'PasskeyError';
    this.reason = reason;
  }
}

/** What one ceremony yields: which credential answered, and its two secrets. */
export interface PasskeySecrets {
  /** base64url, exactly as WebAuthn reports it — the id the backup's door is filed under. */
  credentialId: string;
  /** Opens the cloud backup's passkey door. */
  backup: Uint8Array;
  /** Opens this device's vault door. */
  unlock: Uint8Array;
}

/** The slice of `navigator.credentials` this file calls. Injectable, so a test can fake it. */
export interface CredentialsApi {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

/* ------------------------------- encoding ------------------------------- */

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------ availability ----------------------------- */

/**
 * Can this build even try? True wherever WebAuthn exists, and in the mobile app, which asks
 * the native plugin. Not a promise of PRF — see the header — only that asking is not
 * pointless.
 */
export function passkeyPossible(): boolean {
  if (isMobileApp()) return isTauri();
  const g = globalThis as { PublicKeyCredential?: unknown; navigator?: { credentials?: unknown } };
  return typeof g.PublicKeyCredential === 'function' && !!g.navigator?.credentials;
}

/**
 * The relying party a ceremony names, or undefined to let WebAuthn use the page's host.
 *
 * Named only where it is TRUE of the page — a browser refuses an `rp.id` that is not the
 * page's host or a suffix of it (`SecurityError`), so a localhost build that named
 * `cosmospay.lat` could never make a passkey at all.
 */
export function passkeyRpId(): string | undefined {
  if (isMobileApp()) return PASSKEY_RP_ID;
  const host = (globalThis as { location?: { hostname?: string } }).location?.hostname ?? '';
  return host === PASSKEY_RP_ID || host.endsWith('.' + PASSKEY_RP_ID) ? PASSKEY_RP_ID : undefined;
}

/**
 * Does the platform say it supports PRF? `true`/`false` where it answers
 * (`PublicKeyCredential.getClientCapabilities`, Chrome 133+, Safari 18.4+), `null` where it
 * cannot — which is not a no: older builds that support PRF simply do not report it.
 *
 * In the mobile app the native plugin answers whether the OS can do passkeys at all (Android
 * 9+ with a credential provider, iOS 18+). Whether the provider does PRF is only known after
 * a creation, so a yes there is `null`, never `true`.
 */
export async function passkeyPrfReported(): Promise<boolean | null> {
  if (isMobileApp()) {
    try {
      const status = await nativeInvoke<{ available: boolean }>('passkey_status');
      return status.available ? null : false;
    } catch {
      return false;
    }
  }
  const pkc = (globalThis as { PublicKeyCredential?: { getClientCapabilities?: () => Promise<Record<string, boolean>> } })
    .PublicKeyCredential;
  if (!pkc?.getClientCapabilities) return null;
  try {
    const caps = await pkc.getClientCapabilities();
    return typeof caps['extension:prf'] === 'boolean' ? caps['extension:prf'] : null;
  } catch {
    return null;
  }
}

function defaultApi(): CredentialsApi {
  if (isMobileApp()) {
    if (!isTauri()) throw new PasskeyError('unsupported', 'The native plugin is not available here.');
    return nativeCredentialsApi();
  }
  const creds = (globalThis as { navigator?: { credentials?: CredentialsApi } }).navigator?.credentials;
  if (!creds || !passkeyPossible()) throw new PasskeyError('unsupported', 'WebAuthn is not available here.');
  return creds;
}

/* --------------------------------- salts --------------------------------- */

async function saltOf(label: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(label)));
}

async function prfInputs(): Promise<{ first: Uint8Array; second: Uint8Array }> {
  return { first: await saltOf(PASSKEY_PRF_BACKUP_LABEL), second: await saltOf(PASSKEY_PRF_UNLOCK_LABEL) };
}

/* ------------------------------- ceremonies ------------------------------ */

/**
 * The outcome of a ceremony, classified. `NotAllowedError` is what every browser raises for
 * a dismissed sheet, a timeout and "no credential matched" alike, so all three read as
 * `cancelled` — none of them is a fault to report.
 */
function classify(err: unknown): PasskeyError {
  if (err instanceof PasskeyError) return err;
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return new PasskeyError('cancelled', String(name));
  if (name === 'NotSupportedError' || name === 'SecurityError') return new PasskeyError('unsupported', String(name));
  return new PasskeyError('failed', err instanceof Error ? err.message : String(err));
}

interface PrfResults {
  enabled?: boolean;
  results?: { first?: BufferSource; second?: BufferSource };
}

function prfOf(cred: Credential | null): PrfResults | undefined {
  const pkc = cred as (Credential & { getClientExtensionResults?: () => { prf?: PrfResults } }) | null;
  return pkc?.getClientExtensionResults?.().prf;
}

function bytesOf(src: BufferSource | undefined): Uint8Array | null {
  if (!src) return null;
  const bytes = src instanceof ArrayBuffer ? new Uint8Array(src) : new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  // A copy, so wiping it later cannot reach into a buffer the browser still owns.
  return bytes.length === PASSKEY_SECRET_BYTES ? new Uint8Array(bytes) : null;
}

/** Both outputs, or a `noPrf` refusal — half a pair opens half of what it must. */
function secretsOf(credentialId: string, prf: PrfResults | undefined): PasskeySecrets | null {
  const backup = bytesOf(prf?.results?.first);
  const unlock = bytesOf(prf?.results?.second);
  return backup && unlock ? { credentialId, backup, unlock } : null;
}

/**
 * Ask an existing passkey for its two secrets.
 *
 * `credentialIds` narrows the sheet to the credentials that can open what the caller holds
 * — a backup's doors, this device's door. Empty or absent lets the person pick any passkey
 * this site has, which is only right where nothing is known yet.
 */
export async function getPasskeySecrets(
  credentialIds: readonly string[] = [],
  api: CredentialsApi = defaultApi(),
): Promise<PasskeySecrets> {
  let cred: Credential | null;
  try {
    cred = await api.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        timeout: PASSKEY_TIMEOUT_MS,
        ...(passkeyRpId() ? { rpId: passkeyRpId() } : {}),
        userVerification: 'required',
        allowCredentials: credentialIds.map((id) => ({ type: 'public-key' as const, id: fromBase64Url(id) as BufferSource })),
        extensions: { prf: { eval: await prfInputs() } } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch (err) {
    throw classify(err);
  }
  if (!cred) throw new PasskeyError('cancelled', 'no credential');
  const id = (cred as Credential & { rawId?: ArrayBuffer }).rawId;
  const credentialId = id ? toBase64Url(new Uint8Array(id)) : cred.id;
  const secrets = secretsOf(credentialId, prfOf(cred));
  if (!secrets) throw new PasskeyError('noPrf', 'the authenticator returned no PRF output');
  return secrets;
}

/**
 * Make a new passkey and return its two secrets.
 *
 * Filed under a RANDOM user handle, never the email: the handle is stored by the
 * authenticator and synced with it, and there is no reason for it to name anyone. `name`
 * is what the person sees in their password manager, so it is the address they signed in
 * with.
 *
 * Some authenticators evaluate PRF during creation and some only report that they can
 * (`enabled`); the second kind gets one immediate `get`, which is a second sheet on those
 * browsers and nothing on the rest. A creation that reports neither is `noPrf`: the
 * passkey exists but can hold nothing, and the caller falls back to a password.
 */
export async function createPasskey(
  user: { name: string; displayName: string },
  api: CredentialsApi = defaultApi(),
): Promise<PasskeySecrets> {
  let cred: Credential | null;
  try {
    cred = await api.create({
      publicKey: {
        rp: { name: PASSKEY_RP_NAME, ...(passkeyRpId() ? { id: passkeyRpId() } : {}) },
        user: {
          id: crypto.getRandomValues(new Uint8Array(PASSKEY_USER_ID_BYTES)),
          name: user.name,
          displayName: user.displayName,
        },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        // ES256 first, RS256 for Windows Hello's older TPMs.
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        timeout: PASSKEY_TIMEOUT_MS,
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        extensions: { prf: { eval: await prfInputs() } } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch (err) {
    throw classify(err);
  }
  if (!cred) throw new PasskeyError('cancelled', 'no credential');
  const raw = (cred as Credential & { rawId?: ArrayBuffer }).rawId;
  const credentialId = raw ? toBase64Url(new Uint8Array(raw)) : cred.id;
  const prf = prfOf(cred);
  const direct = secretsOf(credentialId, prf);
  if (direct) return direct;
  if (!prf?.enabled) throw new PasskeyError('noPrf', 'the authenticator does not support PRF');
  return getPasskeySecrets([credentialId], api);
}

/** Overwrite a ceremony's secrets once they have been used. Best effort, like `wipeVaultKey`. */
export function wipePasskeySecrets(s: PasskeySecrets): void {
  s.backup.fill(0);
  s.unlock.fill(0);
}

/* ------------------------------ the native transport ------------------------------ */

/** The one bridge call the adapter needs, injectable so a test can stand in for the phone. */
export type NativeInvoke = <T>(command: 'passkey_create' | 'passkey_get', args: Record<string, unknown>) => Promise<T>;

/**
 * WebAuthn options as the JSON the platforms take: every buffer becomes base64url, which is
 * the encoding `PublicKeyCredentialCreationOptionsJSON` specifies and the one Android's
 * Credential Manager parses as-is. The Swift half reads the same fields.
 */
export function webAuthnJson(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return toBase64Url(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return toBase64Url(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (Array.isArray(value)) return value.map(webAuthnJson);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = webAuthnJson(v);
    return out;
  }
  return value;
}

const bufferOf = (b64url: unknown): ArrayBuffer | undefined => {
  if (typeof b64url !== 'string' || !b64url) return undefined;
  const bytes = fromBase64Url(b64url);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/**
 * A platform's `PublicKeyCredentialJSON` answer, shaped as the `Credential` this file reads:
 * `rawId` and the PRF results as buffers. Only the fields the wallet uses are carried — no
 * attestation, no signature — because nothing here verifies an assertion: the PRF output is
 * the whole point, and the authenticator only releases it to a verified user.
 */
export function credentialFromJson(json: unknown): Credential {
  const c = (json ?? {}) as {
    id?: string;
    rawId?: string;
    clientExtensionResults?: { prf?: { enabled?: boolean; results?: { first?: string; second?: string } } };
  };
  if (typeof c.id !== 'string' || !c.id) throw new PasskeyError('failed', 'the platform answered without a credential id');
  const prf = c.clientExtensionResults?.prf;
  const rawId = bufferOf(c.rawId ?? c.id);
  return {
    id: c.id,
    rawId,
    type: 'public-key',
    getClientExtensionResults: () => ({
      prf: prf
        ? {
            enabled: prf.enabled,
            results: prf.results ? { first: bufferOf(prf.results.first), second: bufferOf(prf.results.second) } : undefined,
          }
        : undefined,
    }),
  } as unknown as Credential;
}

/**
 * A native rejection, classified. The plugin rejects with the same `Failure` tokens the
 * device-unlock commands use (`src-tauri/plugins/cosmos/src/models.rs`); the four that mean
 * "this phone cannot do passkeys" collapse to `unsupported`, so the screen offers the
 * password the way it does in a browser without WebAuthn.
 */
export function nativeFailure(err: unknown): PasskeyError {
  const e = (err ?? {}) as { failure?: unknown; detail?: unknown };
  const detail = typeof e.detail === 'string' ? e.detail : err instanceof Error ? err.message : String(err);
  switch (e.failure) {
    case 'cancelled':
      return new PasskeyError('cancelled', detail);
    case 'unsupported':
    case 'noHardware':
    case 'noPasscode':
    case 'notEnrolled':
      return new PasskeyError('unsupported', detail);
    default:
      // `stale` (no matching passkey on this phone) included: not a dismissal the person
      // chose, so it gets a line rather than silence.
      return new PasskeyError('failed', detail);
  }
}

/**
 * `navigator.credentials`, for the mobile app: the same two calls, carried to the native
 * plugin as WebAuthn JSON and answered with a credential built from its JSON reply.
 */
export function nativeCredentialsApi(invoke: NativeInvoke = nativeInvoke as NativeInvoke): CredentialsApi {
  const call = async (command: 'passkey_create' | 'passkey_get', publicKey: unknown): Promise<Credential> => {
    let out: { responseJson?: unknown };
    try {
      out = await invoke<{ responseJson?: unknown }>(command, {
        payload: { requestJson: JSON.stringify(webAuthnJson(publicKey)) },
      });
    } catch (err) {
      throw nativeFailure(err);
    }
    if (typeof out?.responseJson !== 'string') throw new PasskeyError('failed', 'the platform returned no credential');
    return credentialFromJson(JSON.parse(out.responseJson));
  };
  return {
    create: (o) => call('passkey_create', o.publicKey),
    get: (o) => call('passkey_get', o.publicKey),
  };
}
