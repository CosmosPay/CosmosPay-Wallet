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
import { buildRecoverySetup, buildKeyReplacement, recoverySetupMessage } from '@/lib/recovery';
import { assertSafeChallenge, Sep10Error, webAuthDomainOf } from '@/lib/sep10';
import { DEVICE_WEIGHT, SERVER_WEIGHT } from '@/constants/recovery';
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
  // The platform verifies this signature against its own `recoverySetupMessage`, in a
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
