/**
 * SEP-30 account recovery, on the two things the wallet must get right by itself.
 *
 * **The setup transaction.** It is the only envelope the wallet signs whose operations are
 * in `CRITICAL_OPS`, because changing who may sign for the account is the feature. So it is
 * matched against a template rather than bounded, and the cases below are the ways an
 * envelope can look like a recovery setup and be an account takeover: a third signer, a
 * weight that makes one server sufficient alone, a master weight of zero, a signer riding
 * along with the thresholds, a sponsorship left open, a home domain slipped in.
 *
 * **The SEP-10 challenge.** A server hands the wallet a transaction and asks for a
 * signature on it. What makes that safe is a property the wallet checks for itself —
 * sequence 0, which can never be submitted — and the refusals below are everything else
 * that shape has to satisfy before the key touches it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  MuxedAccount,
} from '@stellar/stellar-sdk';
import { assertSafeToSign, reviewTx, TxGuardError } from '@/lib/txGuard';
import { tNow } from '@/lib/i18n';
import {
  buildRecoverySetup,
  buildKeyReplacement,
  identitiesFor,
  recoverableAccounts,
  describeServer,
  identityRoute,
  identityTokensFromIdToken,
  recoverySetupMessage,
  startRecoveryCodes,
  registerForRecovery,
  updateRecoveryIdentities,
  type RecoveryServer,
} from '@/lib/recovery';
import { assertSafeChallenge, Sep10Error, webAuthDomainOf } from '@/lib/sep10';
import { parseStellarToml } from '@/lib/stellarToml';
import { DEVICE_WEIGHT, RECOVERY_LIST_MAX_PAGES, SERVER_WEIGHT } from '@/constants/recovery';
import type { NetConfig } from '@/lib/stellar';

const CFG: NetConfig = {
  id: 'testnet',
  label: 'Testnet',
  horizon: 'https://horizon-testnet.stellar.org',
  passphrase: Networks.TESTNET,
};

const me = Keypair.random();
const ME = me.publicKey();
const SIGNER_A = Keypair.random().publicKey();
const SIGNER_B = Keypair.random().publicKey();
const sponsorKp = Keypair.random();
const SPONSOR = sponsorKp.publicKey();
const ATTACKER = Keypair.random().publicKey();

const SIGNERS: [string, string] = [SIGNER_A, SIGNER_B];
const base = { signer: ME, destinations: 'self' as const, intent: 'recovery' as const };

/** Build an envelope from raw operations — the shape a hostile server might send. */
function envelope(ops: ReturnType<typeof Operation.setOptions>[], source = ME, timeout = 300): string {
  const builder = new TransactionBuilder(new Account(source, '7'), {
    fee: String(Number(BASE_FEE) * Math.max(ops.length, 1)),
    networkPassphrase: CFG.passphrase,
    memo: Memo.none(),
  });
  for (const op of ops) builder.addOperation(op);
  return builder.setTimeout(timeout).build().toXDR();
}

const addSigner = (key: string, weight = SERVER_WEIGHT, source = ME) =>
  Operation.setOptions({ source, signer: { ed25519PublicKey: key, weight } });

const thresholds = (weight = DEVICE_WEIGHT, extra: Record<string, unknown> = {}) =>
  Operation.setOptions({
    source: ME,
    masterWeight: weight,
    lowThreshold: weight,
    medThreshold: weight,
    highThreshold: weight,
    ...extra,
  } as Parameters<typeof Operation.setOptions>[0]);

/** The sponsored shape, signed by the account that pays — as the operator returns it. */
function sponsored(over: { payer?: Keypair; sponsoredId?: string; ops?: unknown[] } = {}): string {
  const payer = over.payer ?? sponsorKp;
  const ops = (over.ops ?? [
    Operation.beginSponsoringFutureReserves({ sponsoredId: over.sponsoredId ?? ME, source: payer.publicKey() }),
    addSigner(SIGNER_A),
    addSigner(SIGNER_B),
    Operation.endSponsoringFutureReserves({ source: ME }),
    thresholds(),
  ]) as ReturnType<typeof Operation.setOptions>[];
  const tx = TransactionBuilder.fromXDR(envelope(ops), CFG.passphrase);
  tx.sign(payer);
  return tx.toXDR();
}

/** The refusal key, or `null` when the guard accepted the envelope. */
function refusal(xdr: string, opts: Record<string, unknown> = {}): string | null {
  try {
    assertSafeToSign(CFG, xdr, { ...base, signers: SIGNERS, sponsored: false, ...opts } as never);
    return null;
  } catch (e) {
    assert.ok(e instanceof TxGuardError, `expected a guard refusal, got ${String(e)}`);
    return e.key;
  }
}

/* ------------------------------ the happy paths ----------------------------- */

test('the wallet-built setup transaction passes its own guard', () => {
  const xdr = buildRecoverySetup({ account: ME, signers: SIGNERS, sequence: '7', networkPassphrase: CFG.passphrase });
  assert.equal(refusal(xdr), null);
});

test('the operator-sponsored variant passes, signed by the account that pays', () => {
  // The five-operation shape the platform builds: the sponsorship pair around the two
  // signer entries, then the thresholds — and the payer's own signature already on it.
  const xdr = sponsored();
  assert.equal(refusal(xdr, { sponsored: true }), null);
  // A caller expecting the self-paid shape sees five operations where three belong.
  assert.equal(refusal(xdr, { sponsored: false }), 'guard.recoveryOps');
});

test('the weights are exactly the ones that need both servers and neither alone', () => {
  // Not a style assertion: two servers whose shares reach the threshold separately are
  // two independent ways to take the account, and the whole design is the arithmetic.
  assert.equal(SERVER_WEIGHT * 2, DEVICE_WEIGHT);
  assert.ok(SERVER_WEIGHT < DEVICE_WEIGHT);
});

/* -------------------------- takeovers that look right ----------------------- */

test('a third signer nobody agreed to is refused', () => {
  const xdr = envelope([addSigner(SIGNER_A), addSigner(SIGNER_B), addSigner(ATTACKER), thresholds()]);
  assert.equal(refusal(xdr), 'guard.recoveryOps');
});

test('a signer swapped for the attacker’s own key is refused', () => {
  const xdr = envelope([addSigner(SIGNER_A), addSigner(ATTACKER), thresholds()]);
  assert.equal(refusal(xdr), 'guard.recoveryUnknownSigner');
});

test('the same server twice is refused — one server holding both shares is one server', () => {
  const xdr = envelope([addSigner(SIGNER_A), addSigner(SIGNER_A), thresholds()]);
  assert.equal(refusal(xdr), 'guard.recoveryDuplicateSigner');
});

test('a weight that makes one server sufficient on its own is refused', () => {
  const xdr = envelope([addSigner(SIGNER_A, DEVICE_WEIGHT), addSigner(SIGNER_B), thresholds()]);
  assert.equal(refusal(xdr), 'guard.recoverySignerWeight');
});

test('zeroing the master weight locks the owner out, and is refused', () => {
  // The whole takeover in one field: the servers keep their signers, the device keeps a
  // key that can no longer do anything, and everything else about the envelope is right.
  const xdr = envelope([addSigner(SIGNER_A), addSigner(SIGNER_B), thresholds(DEVICE_WEIGHT, { masterWeight: 0 })]);
  assert.equal(refusal(xdr), 'guard.recoveryMasterWeight');
});

test('a threshold above the device’s weight is refused', () => {
  const xdr = envelope([
    addSigner(SIGNER_A),
    addSigner(SIGNER_B),
    thresholds(DEVICE_WEIGHT, { highThreshold: DEVICE_WEIGHT + 1 }),
  ]);
  assert.equal(refusal(xdr), 'guard.recoveryThreshold');
});

test('a signer smuggled onto the thresholds operation is refused', () => {
  const xdr = envelope([
    addSigner(SIGNER_A),
    addSigner(SIGNER_B),
    thresholds(DEVICE_WEIGHT, { signer: { ed25519PublicKey: ATTACKER, weight: DEVICE_WEIGHT } }),
  ]);
  assert.equal(refusal(xdr), 'guard.recoveryThresholdSigner');
});

test('anything else set alongside a signer or the thresholds is refused', () => {
  const withDomain = envelope([
    Operation.setOptions({ source: ME, signer: { ed25519PublicKey: SIGNER_A, weight: SERVER_WEIGHT }, homeDomain: 'attacker.example' }),
    addSigner(SIGNER_B),
    thresholds(),
  ]);
  assert.equal(refusal(withDomain), 'guard.recoveryExtraOption');

  const withInflation = envelope([addSigner(SIGNER_A), addSigner(SIGNER_B), thresholds(DEVICE_WEIGHT, { inflationDest: ATTACKER })]);
  assert.equal(refusal(withInflation), 'guard.recoveryExtraOption');
});

test('CLEARING the home domain is a change too, and is refused', () => {
  // The one option that can be set without being truthy. `setOptions{ homeDomain: '' }`
  // wipes the account's home domain — stellar.toml, federation, anchor discovery — and the
  // "nothing else is set" check read the empty string as an absent field, so this was the
  // single field that got through the template.
  const xdr = envelope([addSigner(SIGNER_A), addSigner(SIGNER_B), thresholds(DEVICE_WEIGHT, { homeDomain: '' })]);
  assert.equal(refusal(xdr), 'guard.recoveryExtraOption');

  const onSigner = envelope([
    Operation.setOptions({ source: ME, signer: { ed25519PublicKey: SIGNER_A, weight: SERVER_WEIGHT }, homeDomain: '' }),
    addSigner(SIGNER_B),
    thresholds(),
  ]);
  assert.equal(refusal(onSigner), 'guard.recoveryExtraOption');
});

test('a cleared home domain renders a row rather than disappearing', () => {
  // Same bug on the presentation side, where it mattered for the DAPP path: the review
  // for an operation that wipes the home domain used to carry no row naming it at all,
  // because an empty value is dropped from the rows.
  const xdr = envelope([Operation.setOptions({ source: ME, homeDomain: '' })]);
  const op = reviewTx(CFG, xdr).operations[0];
  assert.equal(op.control?.homeDomain, '');
  assert.ok(
    op.rows.some((r) => r.label === tNow('guard.row.homeDomain')),
    'clearing the home domain must be visible in the review',
  );
});

test('a hash or pre-authorised-transaction signer is not a recovery signer', () => {
  const xdr = envelope([
    Operation.setOptions({ source: ME, signer: { sha256Hash: Buffer.alloc(32, 7), weight: SERVER_WEIGHT } }),
    addSigner(SIGNER_B),
    thresholds(),
  ]);
  assert.equal(refusal(xdr), 'guard.recoverySignerKind');
});

/* ------------------------------ the sponsorship ----------------------------- */

test('a sponsorship paying for someone else’s reserve is refused', () => {
  // The check that is NOT self-referential: the account it compares against is this
  // device's own key, not anything the envelope supplied.
  assert.equal(refusal(sponsored({ sponsoredId: ATTACKER }), { sponsored: true }), 'guard.recoverySponsored');
});

test('an envelope whose named payer is not the one that signed is refused', () => {
  // Built by one party and signed by another: it could not be submitted, and it is not
  // the transaction it describes itself as. This is what replaced comparing the payer
  // against an address that arrived in the same response as the envelope — a check the
  // operator answered on both sides.
  const other = Keypair.random();
  const tx = TransactionBuilder.fromXDR(
    envelope([
      Operation.beginSponsoringFutureReserves({ sponsoredId: ME, source: SPONSOR }) as never,
      addSigner(SIGNER_A),
      addSigner(SIGNER_B),
      Operation.endSponsoringFutureReserves({ source: ME }) as never,
      thresholds(),
    ]),
    CFG.passphrase,
  );
  tx.sign(other);
  assert.equal(refusal(tx.toXDR(), { sponsored: true }), 'guard.recoveryNotSponsorSignature');
});

test('a sponsorship the account pays for itself is not a sponsorship', () => {
  assert.equal(refusal(sponsored({ payer: me, sponsoredId: ME }), { sponsored: true }), 'guard.recoverySponsorSource');
});

test('a sponsorship left open would swallow whatever the account creates next', () => {
  const xdr = sponsored({
    ops: [
      Operation.beginSponsoringFutureReserves({ sponsoredId: ME, source: SPONSOR }),
      addSigner(SIGNER_A),
      addSigner(SIGNER_B),
      thresholds(),
      // Where the `end` should be — a fifth operation of the wrong kind.
      addSigner(SIGNER_A),
    ],
  });
  assert.equal(refusal(xdr, { sponsored: true }), 'guard.recoveryUnclosedSponsorship');
});

/* ----------------------------- envelope-level ------------------------------- */

test('an envelope sourced by someone else, or with ops on another account, is refused', () => {
  assert.equal(refusal(envelope([addSigner(SIGNER_A), addSigner(SIGNER_B), thresholds()], ATTACKER)), 'guard.foreignSource');
  const foreignOp = envelope([addSigner(SIGNER_A, SERVER_WEIGHT, ATTACKER), addSigner(SIGNER_B), thresholds()]);
  assert.equal(refusal(foreignOp), 'guard.foreignOpSource');
});

test('a value-moving operation cannot ride along in a recovery setup', () => {
  const xdr = envelope([
    addSigner(SIGNER_A),
    addSigner(SIGNER_B),
    Operation.payment({ destination: ATTACKER, asset: Asset.native(), amount: '100' }) as never,
  ]);
  // Refused by the allowlist, naming the operation — before any question of amounts,
  // because a recovery setup has no amounts at all and no bound would have applied.
  assert.equal(refusal(xdr), 'guard.unexpectedOp');
});

test('a self-paid envelope that already carries a signature is not the one we were shown', () => {
  const tx = TransactionBuilder.fromXDR(
    buildRecoverySetup({ account: ME, signers: SIGNERS, sequence: '7', networkPassphrase: CFG.passphrase }),
    CFG.passphrase,
  );
  tx.sign(Keypair.random());
  assert.equal(refusal(tx.toXDR()), 'guard.recoveryPresigned');
});

test('a caller that names the account itself, or one server twice, is refused by name', () => {
  const xdr = buildRecoverySetup({ account: ME, signers: SIGNERS, sequence: '7', networkPassphrase: CFG.passphrase });
  assert.equal(refusal(xdr, { signers: [SIGNER_A, SIGNER_A] }), 'guard.recoverySameSigner');
  assert.equal(refusal(xdr, { signers: [ME, SIGNER_B] }), 'guard.recoverySelfSigner');
});

/* ------------------------- the key-replacement build ------------------------ */

test('recovery replaces the lost key and keeps the account, and the servers keep theirs', () => {
  const fresh = Keypair.random().publicKey();
  const xdr = buildKeyReplacement({ account: ME, newKey: fresh, sequence: '7', networkPassphrase: CFG.passphrase });
  const tx = TransactionBuilder.fromXDR(xdr, CFG.passphrase) as unknown as {
    source: string;
    operations: Record<string, unknown>[];
  };

  assert.equal(tx.source, ME, 'the account is what survives a recovery');
  assert.equal(tx.operations.length, 2);
  assert.deepEqual(tx.operations[0].signer, { ed25519PublicKey: fresh, weight: DEVICE_WEIGHT });
  // The lost key goes to zero. Nothing touches the two recovery signers, so the account
  // can be recovered again from the next device.
  assert.equal(tx.operations[1].masterWeight, 0);
  assert.equal(tx.operations[1].signer, undefined);
});

/* -------------------------------- SEP-10 ----------------------------------- */

const server = Keypair.random();
const HOME = 'wallet.cosmospay.lat';
const WEB_AUTH = 'recovery-a.cosmospay.lat';
const EXPECT = { account: ME, homeDomain: HOME, webAuthDomain: WEB_AUTH };
const NOW = 1_800_000_000;

/** A challenge as a correct server mints one. `over` replaces parts of it. */
function challenge(over: { seq?: string; home?: string; webAuth?: string; nonce?: string; source?: string; extraSource?: string; memo?: Memo; timeout?: number } = {}): string {
  const src = new Account(over.source ?? server.publicKey(), String(Number(over.seq ?? '0') - 1));
  const tx = new TransactionBuilder(src, {
    fee: BASE_FEE,
    networkPassphrase: CFG.passphrase,
    timebounds: { minTime: NOW, maxTime: NOW + (over.timeout ?? 300) },
    memo: over.memo ?? Memo.none(),
  })
    .addOperation(
      Operation.manageData({
        source: ME,
        name: `${over.home ?? HOME} auth`,
        value: over.nonce ?? Buffer.alloc(48, 3).toString('base64'),
      }),
    )
    .addOperation(
      Operation.manageData({
        source: over.extraSource ?? server.publicKey(),
        name: 'web_auth_domain',
        value: over.webAuth ?? WEB_AUTH,
      }),
    )
    .build();
  tx.sign(server);
  return tx.toXDR();
}

/** The refusal key for a challenge, or null when it was accepted. */
function challengeRefusal(xdr: string, now = NOW): string | null {
  try {
    assertSafeChallenge(CFG, xdr, EXPECT, now);
    return null;
  } catch (e) {
    assert.ok(e instanceof Sep10Error, `expected a SEP-10 refusal, got ${String(e)}`);
    return e.key;
  }
}

test('a well-formed challenge is accepted', () => {
  assert.equal(challengeRefusal(challenge()), null);
});

test('a challenge that could actually be submitted is refused', () => {
  // The one property the whole thing rests on. A sequence the account could really use is
  // no longer a challenge — it is a transaction against us, asking to be signed.
  assert.equal(challengeRefusal(challenge({ seq: '12345' })), 'sep10.error.sequence');
});

test('a challenge sourced by our own account is refused', () => {
  assert.equal(challengeRefusal(challenge({ source: ME })), 'sep10.error.ourSource');
});

test('a challenge minted for the sibling server cannot be replayed here', () => {
  assert.equal(challengeRefusal(challenge({ webAuth: 'recovery-b.cosmospay.lat' })), 'sep10.error.webAuthDomain');
});

test('a challenge for another home domain is refused', () => {
  assert.equal(challengeRefusal(challenge({ home: 'attacker.example' })), 'sep10.error.homeDomain');
});

test('a challenge with no entropy is a standing signature, and is refused', () => {
  assert.equal(challengeRefusal(challenge({ nonce: Buffer.alloc(8, 1).toString('base64') })), 'sep10.error.nonce');
});

test('a data entry written on OUR account under cover of a login is refused', () => {
  assert.equal(challengeRefusal(challenge({ extraSource: ME })), 'sep10.error.extraOnUs');
});

test('a challenge is only good inside its window', () => {
  assert.equal(challengeRefusal(challenge(), NOW + 10_000), 'sep10.error.expired');
  assert.equal(challengeRefusal(challenge({ timeout: 60 * 60 * 24 })), 'sep10.error.window');
});

test('a MUXED source does not smuggle our own account past the check', () => {
  // `Transaction.source` renders a muxed source as `M…`, which never string-equals our
  // `G…` address — and an operation with no source of its own inherits it. One prefix
  // therefore defeated both account checks at once, leaving sequence 0 carrying the file
  // alone. Built by hand because the SDK builder takes the muxed account as the source.
  const muxed = new MuxedAccount(new Account(ME, '-1'), '7');
  const tx = new TransactionBuilder(muxed, {
    fee: BASE_FEE,
    networkPassphrase: CFG.passphrase,
    timebounds: { minTime: NOW, maxTime: NOW + 300 },
    memo: Memo.none(),
  })
    .addOperation(Operation.manageData({ source: ME, name: `${HOME} auth`, value: Buffer.alloc(48, 3).toString('base64') }))
    // No source of its own: it inherits the muxed one, which is us.
    .addOperation(Operation.manageData({ name: 'web_auth_domain', value: WEB_AUTH }))
    .build();
  tx.sign(server);
  assert.equal(challengeRefusal(tx.toXDR()), 'sep10.error.ourSource');
});

test('an inherited operation source is checked, not skipped', () => {
  // The later operations belong to the server. One with no explicit source inherits the
  // transaction's — and when that IS us, reading only the explicit field saw nothing.
  const tx = new TransactionBuilder(new Account(ME, '-1'), {
    fee: BASE_FEE,
    networkPassphrase: CFG.passphrase,
    timebounds: { minTime: NOW, maxTime: NOW + 300 },
    memo: Memo.none(),
  })
    .addOperation(Operation.manageData({ source: ME, name: `${HOME} auth`, value: Buffer.alloc(48, 3).toString('base64') }))
    .addOperation(Operation.manageData({ name: 'web_auth_domain', value: WEB_AUTH }))
    .build();
  tx.sign(server);
  // Caught one step earlier, by the transaction source itself — which is the layer that
  // was missing for the muxed case above.
  assert.equal(challengeRefusal(tx.toXDR()), 'sep10.error.ourSource');
});

test('a memo on a challenge is refused', () => {
  assert.equal(challengeRefusal(challenge({ memo: Memo.text('anything') })), 'sep10.error.memo');
});

test('anything that is not a challenge at all is refused before it is read', () => {
  const payment = envelope([Operation.payment({ destination: ATTACKER, asset: Asset.native(), amount: '1' }) as never]);
  assert.equal(challengeRefusal(payment), 'sep10.error.sequence');
  assert.equal(challengeRefusal('not xdr'), 'sep10.error.undecodable');
});

test('the web-auth domain a server must name is derived from the URL the wallet called', () => {
  assert.equal(webAuthDomainOf('https://recovery-a.cosmospay.lat'), 'recovery-a.cosmospay.lat');
  assert.equal(webAuthDomainOf('https://recovery-a.cosmospay.lat:8443/api'), 'recovery-a.cosmospay.lat:8443');
  assert.equal(webAuthDomainOf('nonsense'), '');
});

/* ------------------------- the cross-repo challenge ------------------------- */

test('the sponsored-setup challenge is pinned byte for byte', () => {
  // The community server verifies this signature against its own `recoverySetupMessage`, in a
  // separate repository with no shared code. A rename or a reordering on either side
  // builds cleanly and produces a signature the other one rejects, so the literal is
  // pinned on both sides rather than derived on either.
  assert.equal(
    recoverySetupMessage('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ', ['GAAA', 'GBBB'], '2026-09-19T12:00:00.000Z'),
    'Cosmos Pay Wallet recovery setup\n' +
      'account: GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ\n' +
      'signers: GAAA,GBBB\n' +
      'at: 2026-09-19T12:00:00.000Z',
  );
});

test('the challenge covers the signers, so one signature authorises one arrangement', () => {
  const a = recoverySetupMessage(ME, [SIGNER_A, SIGNER_B], '2026-09-19T12:00:00.000Z');
  const b = recoverySetupMessage(ME, [SIGNER_A, ATTACKER], '2026-09-19T12:00:00.000Z');
  assert.notEqual(a, b);
});


/* --------------------------- the SEP-30 wire itself -------------------------- */

/*
 * The protocol's own surface, as opposed to the envelopes above: which endpoints the
 * wallet calls, with what, and how it walks a paged listing. Everything here runs against
 * a stubbed `fetch`, because what is being asserted is the REQUEST — a listing read one
 * page deep and an identity written to only one server both succeed quietly, and both
 * leave the user worse off than the failure would have.
 */

const SERVERS: RecoveryServer[] = ['a', 'b'].map((role) => ({
  role: role as 'a' | 'b',
  url: `https://recovery-${role}.cosmospay.lat`,
  // The SEP-30 base, which is what the spec's paths hang off — the community server
  // publishes it in its TOML; somebody else's would very often be the bare host.
  sep30Base: `https://recovery-${role}.cosmospay.lat/cosmos-api/v1/sep30`,
  webAuthEndpoint: `https://recovery-${role}.cosmospay.lat/cosmos-api/v1/sep10/auth`,
  webAuthDomain: `recovery-${role}.cosmospay.lat`,
  homeDomain: HOME,
  signingKey: server.publicKey(),
  oidcIssuer: 'https://auth.cosmospay.lat/application/o/wallet/',
  emailCodes: true,
}));

/** A standalone SEP-30 deployment: no /api prefix anywhere, exactly as the spec reads. */
const THIRD_PARTY: RecoveryServer = {
  role: 'a',
  url: 'https://recovery.example.org',
  sep30Base: 'https://recovery.example.org',
  webAuthEndpoint: 'https://recovery.example.org/auth',
  webAuthDomain: 'recovery.example.org',
  homeDomain: HOME,
  signingKey: server.publicKey(),
  emailCodes: false,
};

/** One account row in the shape SEP-30's listing returns it. */
const row = (address: string, signer: string) => ({
  address,
  identities: [{ role: 'owner', authenticated: true }],
  signers: [{ key: signer, added_at: '2026-01-01T00:00:00Z' }],
});

/** A challenge for `host` inside a real time window, so `signChallenge` accepts it. */
function liveChallenge(host: string): string {
  const now = Math.floor(Date.now() / 1000);
  const tx = new TransactionBuilder(new Account(server.publicKey(), '-1'), {
    fee: BASE_FEE,
    networkPassphrase: CFG.passphrase,
    timebounds: { minTime: now - 5, maxTime: now + 300 },
    memo: Memo.none(),
  })
    .addOperation(Operation.manageData({ source: ME, name: `${HOME} auth`, value: Buffer.alloc(48, 7).toString('base64') }))
    .addOperation(Operation.manageData({ source: server.publicKey(), name: 'web_auth_domain', value: host }))
    .build();
  tx.sign(server);
  return tx.toXDR();
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Stand in for both servers. `pages` answers each host's listing one page per call;
 * everything else gets a challenge, a token or an echo. The calls are what the tests
 * assert on — the request is the behaviour here, not the reply.
 */
function stubFetch(pages: Record<string, unknown[][]>): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  const cursor: Record<string, number> = {};

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });

    const host = new URL(url).host;
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (url.includes('/auth')) {
      return method === 'GET'
        ? json({ transaction: liveChallenge(host), network_passphrase: CFG.passphrase })
        : json({ token: `token-for-${host}` });
    }
    if (url.includes('/accounts')) {
      if (method === 'GET') {
        const i = cursor[host] ?? 0;
        cursor[host] = i + 1;
        return json({ accounts: pages[host]?.[i] ?? [] });
      }
      // The PUT's echo. Per host, because the two servers hold DIFFERENT keys and a stub
      // that returned one key twice would be exercising `sameSigner` instead of the path
      // under test.
      return json(row(ME, host.includes('-b') ? SIGNER_B : SIGNER_A));
    }
    return json({});
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

test('an identity is normalised once, so registration and update cannot describe it differently', () => {
  // A capital or a stray space is the same inbox, and must not become a second identity.
  assert.deepEqual(identitiesFor('  Alice@Example.COM '), [
    { role: 'owner', auth_methods: [{ type: 'email', value: 'alice@example.com' }] },
  ]);
});

test('updating the identity is a PUT to both servers, each proven to separately', async () => {
  const { calls, restore } = stubFetch({});
  try {
    await updateRecoveryIdentities(CFG, SERVERS, ME, me.secret(), 'New@Example.com');
  } finally {
    restore();
  }

  // SEP-30's `PUT /accounts/<address>`, not a second POST: registering again would be
  // asking for a signer that is already on the ledger.
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2, 'both servers, or the account is recoverable from two inboxes');
  assert.deepEqual(
    puts.map((c) => c.url),
    SERVERS.map((s) => `${s.sep30Base}/accounts/${ME}`),
  );
  for (const put of puts) assert.deepEqual(put.body, { identities: identitiesFor('new@example.com') });

  // A token minted by one server is refused by the other, which is the whole reason
  // there are two of them.
  assert.equal(calls.filter((c) => c.url.endsWith('/auth') && c.method === 'POST').length, 2);
});

test('a server that refuses the update fails the whole thing, so no new address is claimed', async () => {
  const { restore } = stubFetch({});
  const stubbed = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('recovery-b') && init?.method === 'PUT') return new Response('{}', { status: 500 });
    return stubbed(input as never, init);
  }) as typeof fetch;

  try {
    // After this the account is still recoverable from the OLD address on at least one
    // server, and the caller must not record the new one as if it were registered.
    await assert.rejects(() => updateRecoveryIdentities(CFG, SERVERS, ME, me.secret(), 'new@example.com'));
  } finally {
    restore();
  }
});

test('the recoverable listing follows SEP-30 cursor to the end', async () => {
  const [x, y, z] = [Keypair.random().publicKey(), Keypair.random().publicKey(), Keypair.random().publicKey()];
  const { calls, restore } = stubFetch({
    'recovery-a.cosmospay.lat': [[row(x, SIGNER_A), row(y, SIGNER_A)], [row(z, SIGNER_A)], []],
    'recovery-b.cosmospay.lat': [[row(x, SIGNER_B), row(y, SIGNER_B)], [row(z, SIGNER_B)], []],
  });

  let found: string[];
  try {
    found = (await recoverableAccounts(SERVERS, ['ta', 'tb'])).map((r) => r.address);
  } finally {
    restore();
  }

  // The account on page two is the point: reading one page shows someone SOME of their
  // wallets and tells them it is all of them — which from the outside is
  // indistinguishable from a wallet that was never protected at all.
  assert.deepEqual(found, [x, y, z]);
  assert.ok(
    calls.some((c) => c.url.includes(`after=${y}`)),
    'the cursor is the last address of the page before',
  );
});

test('a server that ignores the cursor does not page forever', async () => {
  const a = Keypair.random().publicKey();
  // The same page every time, which is what a server that drops `after` returns.
  const forever = Array.from({ length: RECOVERY_LIST_MAX_PAGES + 5 }, () => [row(a, SIGNER_A)]);
  const { calls, restore } = stubFetch({
    'recovery-a.cosmospay.lat': forever,
    'recovery-b.cosmospay.lat': [[row(a, SIGNER_B)], []],
  });

  let found: string[];
  try {
    found = (await recoverableAccounts(SERVERS, ['ta', 'tb'])).map((r) => r.address);
  } finally {
    restore();
  }

  assert.deepEqual(found, [a]);
  const listings = calls.filter((c) => c.url.includes('/accounts') && c.method === 'GET');
  assert.ok(listings.length <= RECOVERY_LIST_MAX_PAGES * 2, `walked ${listings.length} pages`);
});

test('an account only one server knows is not offered, however many pages it took to find', async () => {
  const mine = Keypair.random().publicKey();
  const theirs = Keypair.random().publicKey();
  const { restore } = stubFetch({
    'recovery-a.cosmospay.lat': [[row(mine, SIGNER_A)], [row(theirs, SIGNER_A)], []],
    'recovery-b.cosmospay.lat': [[row(mine, SIGNER_B)], []],
  });

  try {
    // One signature never reaches the threshold, so offering it would be a button that
    // fails at the last step — after the person has been told their funds are coming back.
    const found = (await recoverableAccounts(SERVERS, ['ta', 'tb'])).map((r) => r.address);
    assert.deepEqual(found, [mine]);
  } finally {
    restore();
  }
});


/* ----------------------- talking to somebody else's server ------------------- */

/*
 * The wallet used to build `/api/recovery/...` and `/api/sep10/auth` into every request,
 * which made it a client of exactly one deployment — ours — while the bodies it sent and
 * parsed were already SEP-30's and SEP-10's. The paths now hang off what the server says
 * it is, so a standalone recovery signer is reachable and our own is a special case of it.
 */

test('a standalone SEP-30 server is addressed at the spec\u2019s own paths', async () => {
  const { calls, restore } = stubFetch({});
  try {
    await updateRecoveryIdentities(CFG, [THIRD_PARTY], ME, me.secret(), 'a@b.com');
  } finally {
    restore();
  }

  // No /api anywhere: `${base}/accounts/{address}` is what SEP-30 actually specifies.
  assert.deepEqual(
    calls.filter((c) => c.method === 'PUT').map((c) => c.url),
    [`https://recovery.example.org/accounts/${ME}`],
  );
  assert.ok(calls.some((c) => c.url.startsWith('https://recovery.example.org/auth')), 'SEP-10 goes to the published endpoint');
});

test('the listing cursor works the same against a bare host', async () => {
  const a = Keypair.random().publicKey();
  const { calls, restore } = stubFetch({ 'recovery.example.org': [[row(a, SIGNER_A)], []] });
  try {
    await recoverableAccounts([THIRD_PARTY], ['token']);
  } finally {
    restore();
  }
  assert.ok(calls.some((c) => c.url.startsWith('https://recovery.example.org/accounts')));
});

test('a challenge is refused unless it is signed by the key the server publishes', () => {
  // SEP-10's proof rests on this and the wallet could not make it before: with no TOML
  // there was no published key to compare against, so every check established that the
  // challenge was harmless to sign and none established who was asking.
  const mine = challenge();
  assert.equal(challengeRefusal(mine), null, 'unchecked when no key is published');

  const withKey = (key: string) => {
    try {
      assertSafeChallenge(CFG, mine, { ...EXPECT, signingKey: key }, NOW);
      return null;
    } catch (e) {
      return (e as Sep10Error).key;
    }
  };
  assert.equal(withKey(server.publicKey()), null, 'the real signer passes');
  assert.equal(withKey(Keypair.random().publicKey()), 'sep10.error.signingKey');
});

test('registering an account a server already holds becomes the PUT the spec asks for', async () => {
  // SEP-30 makes POST-on-existing a 409 and points at PUT. That state is reachable and
  // ordinary: an enrolment that registered with both servers and then failed before the
  // transaction reached the ledger is exactly what a person retries from.
  const { calls, restore } = stubFetch({});
  const stubbed = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST' && String(input).includes('/accounts/')) {
      return new Response(JSON.stringify({ error: 'This account is already registered for recovery.' }), { status: 409 });
    }
    return stubbed(input as never, init);
  }) as typeof fetch;

  let signers: [string, string];
  try {
    signers = await registerForRecovery(CFG, SERVERS, ME, me.secret(), 'person@example.com');
  } finally {
    restore();
  }

  // The signer still comes back — which is the whole reason the flow calls this — and it
  // came from the PUT rather than from a second registration.
  assert.deepEqual(signers, [SIGNER_A, SIGNER_B]);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 2);
});

/* ------------------------------ discovery ---------------------------------- */

/*
 * SEP-30 defines no discovery at all, so what a wallet knows about a server before it
 * trusts it comes from SEP-10's stellar.toml. The parser is deliberately small: it is fed
 * by a host the user can type into a settings field, so everything it does not understand
 * must come back absent rather than defaulted — absent is refused upstream, a default is
 * a check that passes against whoever answered.
 */

test('the two fields that matter are read, and the rest is ignored', () => {
  const toml = parseStellarToml(
    [
      '# a comment',
      'VERSION = "2.7.0"',
      'NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015"',
      'WEB_AUTH_ENDPOINT = "https://recovery.example.org/auth"',
      `SIGNING_KEY = "${SIGNER_A}"`,
      'UNRELATED = "whatever"',
    ].join('\n'),
  );
  assert.equal(toml.webAuthEndpoint, 'https://recovery.example.org/auth');
  assert.equal(toml.signingKey, SIGNER_A);
  // A passphrase contains a semicolon and, in the mainnet one, no '#' — but the quoting
  // rule is what keeps any of it from being read as a comment.
  assert.equal(toml.networkPassphrase, 'Public Global Stellar Network ; September 2015');
});

test('a key inside a table cannot masquerade as the server\u2019s own', () => {
  // Parsing stops at the first table header. A SIGNING_KEY in a [[CURRENCIES]] block is a
  // different key with the same name, and reading on would let it overwrite the real one.
  const toml = parseStellarToml(
    [`SIGNING_KEY = "${SIGNER_A}"`, '', '[[CURRENCIES]]', `SIGNING_KEY = "${SIGNER_B}"`].join('\n'),
  );
  assert.equal(toml.signingKey, SIGNER_A);
});

test('a malformed or insecure value is absent, never a best guess', () => {
  const toml = parseStellarToml(
    ['WEB_AUTH_ENDPOINT = "http://recovery.example.org/auth"', 'SIGNING_KEY = "not-a-stellar-key"'].join('\n'),
  );
  // http:// is not a transport to send a token over, and a key that is not a key would be
  // compared against a challenge source and never match — failing later, and less clearly.
  assert.equal(toml.webAuthEndpoint, undefined);
  assert.equal(toml.signingKey, undefined);
});

test('two servers on different hosts still name ONE wallet domain', async () => {
  // The check that matters is `loadRecoveryServers` requiring both to report the SAME
  // home domain — it is what makes a server's claim about itself worth anything, since
  // whoever controls one cannot change what the other says. Taking the home domain from
  // the host each TOML was fetched from would make the pair disagree by construction and
  // refuse every configuration, including the correct one.
  const toml = (host: string) =>
    [
      'NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"',
      `WEB_AUTH_ENDPOINT = "https://${host}/cosmos-api/v1/sep10/auth"`,
      `SIGNING_KEY = "${server.publicKey()}"`,
      `HOME_DOMAIN = "${HOME}"`,
      '',
      '[[RECOVERY_SERVERS]]',
      `ENDPOINT = "https://${host}/cosmos-api/v1/sep30"`,
    ].join('\n');

  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const host = new URL(String(input)).host;
    return new Response(toml(host), { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }) as typeof fetch;

  let pair: Awaited<ReturnType<typeof describeServer>>[];
  try {
    pair = await Promise.all(
      (['a', 'b'] as const).map((role) => describeServer(CFG, role, `https://recovery-${role}.cosmospay.lat`)),
    );
  } finally {
    globalThis.fetch = real;
  }

  assert.equal(pair[0].homeDomain, HOME);
  assert.equal(pair[0].homeDomain, pair[1].homeDomain, 'the pair must agree, or no wallet can enrol');
  // They are still distinct servers in every way that matters.
  assert.notEqual(pair[0].webAuthDomain, pair[1].webAuthDomain);
  assert.equal(pair[0].signingKey, server.publicKey(), 'the published key is carried through to the challenge check');
  // The base comes from the server's own TOML — never a prefix the wallet assembles.
  assert.equal(pair[0].sep30Base, 'https://recovery-a.cosmospay.lat/cosmos-api/v1/sep30');
});

/* ------------------------ discovery refuses, never guesses ------------------------ */

/** Serve one TOML body for every host, for the length of `run`. */
async function withToml<T>(body: string, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

const goodToml = (over: Record<string, string | null> = {}) => {
  const fields: Record<string, string | null> = {
    NETWORK_PASSPHRASE: '"Test SDF Network ; September 2015"',
    WEB_AUTH_ENDPOINT: '"https://recovery-a.cosmospay.lat/cosmos-api/v1/sep10/auth"',
    SIGNING_KEY: `"${SIGNER_A}"`,
    HOME_DOMAIN: `"${HOME}"`,
    ...over,
  };
  const top = Object.entries(fields)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k} = ${v}`);
  const endpoint = over.ENDPOINT === undefined ? '"https://recovery-a.cosmospay.lat/cosmos-api/v1/sep30"' : over.ENDPOINT;
  return [...top.filter((l) => !l.startsWith('ENDPOINT')), '[[RECOVERY_SERVERS]]', ...(endpoint ? [`ENDPOINT = ${endpoint}`] : [])].join('\n');
};

const refusesWith = async (body: string, key: string) =>
  withToml(body, () =>
    assert.rejects(describeServer(CFG, 'a', 'https://recovery-a.cosmospay.lat'), (e: unknown) => {
      assert.equal((e as { key?: string }).key, key);
      return true;
    }),
  );

test('a server with no SIGNING_KEY is refused, not trusted on shape alone', () =>
  refusesWith(goodToml({ SIGNING_KEY: null }), 'recovery.error.discovery'));

test('a server with no SEP-30 endpoint is refused rather than given one', () =>
  refusesWith(goodToml({ ENDPOINT: null }), 'recovery.error.discovery'));

test('a TOML that names no network is refused — a signer lives on one ledger', () =>
  refusesWith(goodToml({ NETWORK_PASSPHRASE: null }), 'recovery.error.network'));

test('a SEP-30 endpoint on another host hands the wallet to a stranger', () =>
  refusesWith(goodToml({ ENDPOINT: '"https://elsewhere.example.com/v1/sep30"' }), 'recovery.error.domain'));

test('the recovery table is read, and a second entry is not a second server', () => {
  const toml = parseStellarToml(
    [
      `SIGNING_KEY = "${SIGNER_A}"`,
      '[[RECOVERY_SERVERS]]',
      'ENDPOINT = "https://recovery-a.cosmospay.lat/v1/sep30"',
      'ROLE = "a"',
      'OIDC_ISSUER = "https://auth.cosmospay.lat/application/o/wallet/"',
      'EMAIL_CODES = true',
      `SIGNING_KEY = "${SIGNER_B}"`,
      '[[RECOVERY_SERVERS]]',
      'ENDPOINT = "https://evil.example.com/v1/sep30"',
    ].join('\n'),
  );
  assert.equal(toml.recovery?.endpoint, 'https://recovery-a.cosmospay.lat/v1/sep30');
  assert.equal(toml.recovery?.oidcIssuer, 'https://auth.cosmospay.lat/application/o/wallet/');
  assert.equal(toml.recovery?.emailCodes, true);
  // A key inside the table is not the server's own.
  assert.equal(toml.signingKey, SIGNER_A);
});

test('a quoted "true" is a string, not a capability', () => {
  const toml = parseStellarToml(['[[RECOVERY_SERVERS]]', 'EMAIL_CODES = "true"'].join('\n'));
  assert.equal(toml.recovery?.emailCodes, undefined);
});

/* ------------------------------ proving the inbox ------------------------------ */

test('an Authentik ID token is the route only when BOTH servers take one', () => {
  assert.deepEqual(identityRoute(SERVERS, 'id.token'), { kind: 'oidc' });
  const noOidc = [SERVERS[0], { ...SERVERS[1], oidcIssuer: undefined }];
  // One server that cannot verify it means each proves the inbox by its own code.
  assert.deepEqual(identityRoute(noOidc, 'id.token'), { kind: 'email' });
  assert.deepEqual(identityRoute(SERVERS, undefined), { kind: 'email' });
  assert.equal(identityRoute(noOidc.map((s) => ({ ...s, emailCodes: false })), undefined), null);
});

test('the ID token goes to each server once, as SEP-30 external auth', async () => {
  const real = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ token: `tok-${calls.length}`, expires_in: 1800 }), { status: 200 });
  }) as typeof fetch;
  let tokens: string[];
  try {
    tokens = await identityTokensFromIdToken(SERVERS, 'the.id.token');
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(tokens, ['tok-1', 'tok-2']);
  assert.deepEqual(
    calls.map((c) => c.url),
    SERVERS.map((s) => `${s.sep30Base}/identity`),
  );
  assert.deepEqual(calls[0].body, { id_token: 'the.id.token' });
});

test('each server is asked for its OWN code', async () => {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ claim_token: `c${urls.length}`, expires_in: 900 }), { status: 200 });
  }) as typeof fetch;
  let claims: string[];
  try {
    claims = await startRecoveryCodes(SERVERS, 'Person@Example.com');
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(claims, ['c1', 'c2']);
  assert.deepEqual(urls, SERVERS.map((s) => `${s.sep30Base}/identity/email/start`));
});
