/**
 * The two Pollar pieces worth pinning: PKCE, and the check that a signature Pollar
 * returns is a signature over the transaction the wallet sent.
 *
 * The second one is the load-bearing test in this file. Asking a remote party to sign
 * means its answer is an envelope of its choosing, and every other guarantee in the
 * signing path — the whole of `txGuard` — is about the envelope the wallet BUILT. If
 * `verifySigned` ever stops distinguishing those two, the guard keeps passing and the
 * wallet starts submitting transactions nobody reviewed.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { Account, Asset, BASE_FEE, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { newPkce } from '@/lib/pkce';
import { verifySigned, PollarSignatureError } from '@/lib/pollarApi';
import { waitForCode, PollarHandshakeError, type PollarHandshake, type PollarSessionStatus } from '@/lib/pollar';
import type { NetConfig } from '@/lib/stellar';

const cfg = { id: 'testnet', passphrase: Networks.TESTNET } as NetConfig;

/** An unsigned payment from `kp`, and a builder for variants of it. */
function build(kp: Keypair, opts: { amount?: string; seq?: string; dest?: string } = {}): string {
  const account = new Account(kp.publicKey(), opts.seq ?? '1');
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: cfg.passphrase })
    .addOperation(
      Operation.payment({
        destination: opts.dest ?? Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: opts.amount ?? '1',
      }),
    )
    .setTimeout(120)
    .build()
    .toXDR();
}

function sign(xdr: string, kp: Keypair): string {
  const tx = TransactionBuilder.fromXDR(xdr, cfg.passphrase);
  tx.sign(kp);
  return tx.toXDR();
}

/** node:test's `assert.throws` returns nothing, so the reason cannot be read off it. */
function reasonOf(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof PollarSignatureError, `expected PollarSignatureError, got ${String(e)}`);
    return (e as PollarSignatureError).reason;
  }
  assert.fail('expected a refusal, got none');
}

/* --------------------------------- PKCE ---------------------------------- */

test('PKCE produces a base64url verifier and an S256 challenge of it', async () => {
  const { verifier, challenge, method } = await newPkce();

  assert.equal(method, 'S256');
  // RFC 7636 bounds the verifier at 43-128 characters and the unreserved set. `+` and
  // `/` here would survive every local test and then be re-encoded in the query string,
  // so the server would hash something else and only the last step of a real login
  // would fail.
  assert.ok(verifier.length >= 43 && verifier.length <= 128, `verifier length ${verifier.length}`);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);

  // The challenge must actually be SHA-256 of the verifier, not merely well-shaped.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const expected = Buffer.from(digest).toString('base64url');
  assert.equal(challenge, expected);
});

test('PKCE verifiers do not repeat', async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) seen.add((await newPkce()).verifier);
  assert.equal(seen.size, 20);
});

/* ---------------------------- signature checking -------------------------- */

test('accepts the transaction it sent, signed by the account', () => {
  const kp = Keypair.random();
  const unsigned = build(kp);
  assert.doesNotThrow(() => verifySigned(cfg, unsigned, sign(unsigned, kp), kp.publicKey()));
});

test('refuses a signature over a DIFFERENT transaction', () => {
  // The attack the check exists for: a valid signature, by the right key, over an
  // envelope the user never saw. Everything but the transaction is correct here.
  const kp = Keypair.random();
  const shown = build(kp, { amount: '1' });
  const swapped = sign(build(kp, { amount: '1000' }), kp);

  assert.equal(reasonOf(() => verifySigned(cfg, shown, swapped, kp.publicKey())), 'different-transaction');
});

test('refuses an envelope that came back unsigned', () => {
  const kp = Keypair.random();
  const unsigned = build(kp);
  assert.equal(reasonOf(() => verifySigned(cfg, unsigned, unsigned, kp.publicKey())), 'unsigned');
});

test('refuses a signature by some other key', () => {
  const kp = Keypair.random();
  const unsigned = build(kp);
  const stranger = sign(unsigned, Keypair.random());
  assert.equal(reasonOf(() => verifySigned(cfg, unsigned, stranger, kp.publicKey())), 'wrong-signer');
});

test('refuses a signature made against a different network', () => {
  // A signature over the same operations on mainnet is not a signature for testnet:
  // the passphrase is part of what is hashed. Decoding with our own passphrase is what
  // makes this fail closed rather than submit a signature that cannot verify.
  const kp = Keypair.random();
  const unsigned = build(kp);
  const other = TransactionBuilder.fromXDR(unsigned, cfg.passphrase);
  const mainnet = TransactionBuilder.fromXDR(other.toXDR(), Networks.PUBLIC);
  mainnet.sign(kp);

  assert.equal(reasonOf(() => verifySigned(cfg, unsigned, mainnet.toXDR(), kp.publicKey())), 'wrong-signer');
});

test('refuses a response that is not a transaction at all', () => {
  const kp = Keypair.random();
  assert.equal(reasonOf(() => verifySigned(cfg, build(kp), 'bm90LWFuLWVudmVsb3Bl', kp.publicKey())), 'not-a-transaction');
});

test('accepts a sponsorship fee bump around the same inner transaction', () => {
  // Pollar wraps a transaction in a fee bump when it is paying the fee, which is the
  // feature that lets a user holding no XLM transact. The inner hash still has to match.
  const kp = Keypair.random();
  const sponsor = Keypair.random();
  const unsigned = build(kp);
  const inner = TransactionBuilder.fromXDR(sign(unsigned, kp), cfg.passphrase);

  const bump = TransactionBuilder.buildFeeBumpTransaction(sponsor, String(Number(BASE_FEE) * 2), inner as never, cfg.passphrase);
  bump.sign(sponsor);

  assert.doesNotThrow(() => verifySigned(cfg, unsigned, bump.toXDR(), kp.publicKey()));
});

test('refuses a fee bump whose fee is above the wallet ceiling', () => {
  const kp = Keypair.random();
  const sponsor = Keypair.random();
  const unsigned = build(kp);
  const inner = TransactionBuilder.fromXDR(sign(unsigned, kp), cfg.passphrase);

  // A fee bump can name any fee, and the payer is not the user — but an absurd one is
  // still a signal that something is wrong with the counterparty, so it is bounded by
  // the same ceiling txGuard puts on a transaction's own fee.
  const bump = TransactionBuilder.buildFeeBumpTransaction(sponsor, '100000000', inner as never, cfg.passphrase);
  bump.sign(sponsor);

  assert.equal(reasonOf(() => verifySigned(cfg, unsigned, bump.toXDR(), kp.publicKey())), 'fee-too-high');
});

test('refuses a fee bump wrapping a DIFFERENT inner transaction', () => {
  const kp = Keypair.random();
  const sponsor = Keypair.random();
  const shown = build(kp, { amount: '1' });
  const other = TransactionBuilder.fromXDR(sign(build(kp, { amount: '9999' }), kp), cfg.passphrase);

  const bump = TransactionBuilder.buildFeeBumpTransaction(sponsor, String(Number(BASE_FEE) * 2), other as never, cfg.passphrase);
  bump.sign(sponsor);

  assert.equal(reasonOf(() => verifySigned(cfg, shown, bump.toXDR(), kp.publicKey())), 'different-transaction');
});

/* ------------------------------- the wait loop ---------------------------- */

/**
 * The loop both logins share. It became testable when the poller became a parameter —
 * which is also why it is one: the direct path polls the gateway with the wallet's key
 * and the brokered path polls the dev platform, and a second copy of these rules is a
 * second place for a login to hang.
 */
const handshake = (): PollarHandshake => ({
  state: 'st4te',
  provider: 'google',
  verifier: 'v'.repeat(43),
  startedAt: Date.now(),
});

/** A poller that answers the given statuses in order, then repeats the last one. */
function poller(...answers: PollarSessionStatus[]) {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    poll: (state: string) => {
      calls.push(state);
      return Promise.resolve(answers[Math.min(i++, answers.length - 1)]);
    },
  };
}

const noSleep = () => Promise.resolve();

test('waits through pending answers and returns the code', async () => {
  const p = poller(
    { status: 'pending', state: 'st4te' },
    { status: 'pending', state: 'st4te' },
    { status: 'authorized', state: 'st4te', code: 'c0de' },
  );
  const code = await waitForCode(p.poll, handshake(), () => false, noSleep);
  assert.equal(code, 'c0de');
  assert.equal(p.calls.length, 3);
});

test('every non-pending status stops the loop rather than reading as "keep waiting"', async () => {
  for (const status of ['failed', 'expired', 'consumed', 'exchanging'] as const) {
    const p = poller({ status, state: 'st4te' });
    await assert.rejects(
      () => waitForCode(p.poll, handshake(), () => false, noSleep),
      (e: unknown) => e instanceof PollarHandshakeError && e.status === status,
      `${status} should be terminal`,
    );
  }
});

test('stops before polling when the caller has given up', async () => {
  // Checked BEFORE each poll, not only between sleeps: the wallet can be locked while a
  // consent screen is open, and a loop that only notices at its own cadence keeps an
  // authenticated request going for minutes after the screen that wanted it is gone.
  const p = poller({ status: 'pending', state: 'st4te' });
  await assert.rejects(
    () => waitForCode(p.poll, handshake(), () => true, noSleep),
    (e: unknown) => e instanceof PollarHandshakeError && e.status === 'timeout',
  );
  assert.equal(p.calls.length, 0);
});

test('gives up on its own once the handshake window has passed', async () => {
  const stale: PollarHandshake = { ...handshake(), startedAt: Date.now() - 60 * 60 * 1000 };
  const p = poller({ status: 'authorized', state: 'st4te', code: 'c0de' });
  await assert.rejects(
    () => waitForCode(p.poll, stale, () => false, noSleep),
    (e: unknown) => e instanceof PollarHandshakeError && e.status === 'timeout',
  );
  assert.equal(p.calls.length, 0);
});
