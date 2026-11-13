/**
 * A service's SEP-10 login pasted into the manual signing screen (`lib/webAuth.ts`).
 *
 * The manual screen refuses another account's envelope that also names ours; a challenge is
 * that shape, so it takes this path instead. Each refusal below is a way a pasted "login"
 * could be something else, or come from someone else: the claim has to match the domain's
 * own stellar.toml, the challenge has to be sourced AND signed by its published key, and it
 * still has to pass `assertSafeChallenge` in full.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Account, BASE_FEE, Keypair, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { assertServerSigned, challengeClaimOf, isChallengeDomain, Sep10Error } from '@/lib/sep10';
import { signVerifiedChallenge, verifyChallenge, type TomlReader } from '@/lib/webAuth';
import type { StellarToml } from '@/lib/stellarToml';
import type { NetConfig } from '@/lib/stellar';

const CFG: NetConfig = {
  id: 'public',
  label: 'Mainnet',
  horizon: 'https://horizon.stellar.org',
  passphrase: Networks.PUBLIC,
};

const me = Keypair.random();
const ME = me.publicKey();
const server = Keypair.random();
const HOME = 'api.anchor.example';
const NOW = Math.floor(Date.now() / 1000);

const TOML: StellarToml = {
  signingKey: server.publicKey(),
  webAuthEndpoint: `https://${HOME}/auth`,
  networkPassphrase: Networks.PUBLIC,
};
const reader = (toml: StellarToml | null): TomlReader => async () => toml;

/** A login as a correct service mints one. `over` replaces parts of it. */
function challenge(
  over: { seq?: string; home?: string; webAuth?: string; source?: string; signer?: Keypair; account?: string } = {},
): string {
  const src = new Account(over.source ?? server.publicKey(), String(Number(over.seq ?? '0') - 1));
  const tx = new TransactionBuilder(src, {
    fee: BASE_FEE,
    networkPassphrase: CFG.passphrase,
    timebounds: { minTime: NOW, maxTime: NOW + 300 },
    memo: Memo.none(),
  })
    .addOperation(
      Operation.manageData({ source: over.account ?? ME, name: `${over.home ?? HOME} auth`, value: Buffer.alloc(48, 7).toString('base64') }),
    )
    .addOperation(Operation.manageData({ source: server.publicKey(), name: 'web_auth_domain', value: over.webAuth ?? HOME }))
    .build();
  tx.sign(over.signer ?? server);
  return tx.toXDR();
}

async function refusal(xdr: string, toml: StellarToml | null = TOML): Promise<string | null> {
  try {
    await verifyChallenge(CFG, xdr, ME, reader(toml), NOW);
    return null;
  } catch (e) {
    assert.ok(e instanceof Sep10Error, `expected a SEP-10 refusal, got ${String(e)}`);
    return e.key;
  }
}

test('a login is recognised by its shape, with the domain it names', () => {
  assert.deepEqual(challengeClaimOf(CFG, challenge()), { homeDomain: HOME, webAuthDomain: HOME });
});

test('anything that could run on the network is not a login', () => {
  assert.equal(challengeClaimOf(CFG, challenge({ seq: '42' })), null);
});

test('an envelope that is not only data entries is not a login', () => {
  const pay = new TransactionBuilder(new Account(server.publicKey(), '-1'), { fee: BASE_FEE, networkPassphrase: CFG.passphrase, timebounds: { minTime: 0, maxTime: NOW + 300 } })
    .addOperation(Operation.manageData({ source: ME, name: `${HOME} auth`, value: 'x' }))
    .addOperation(Operation.bumpSequence({ bumpTo: '1' }))
    .build()
    .toXDR();
  assert.equal(challengeClaimOf(CFG, pay), null);
});

test('a domain that a URL would read as a path, credentials or another host is not one', () => {
  assert.equal(isChallengeDomain('api.anclap.com'), true);
  assert.equal(isChallengeDomain('localhost:8000'), true);
  assert.equal(isChallengeDomain('evil.example/x'), false);
  assert.equal(isChallengeDomain('a@b.example'), false);
  assert.equal(isChallengeDomain('evil.example#good.example'), false);
  assert.equal(isChallengeDomain(''), false);
  assert.equal(challengeClaimOf(CFG, challenge({ home: 'evil.example/x' })), null);
});

test('a login the domain published the key of, sourced and signed by it, is accepted', async () => {
  assert.equal(await refusal(challenge()), null);
});

test('a domain that publishes no signing key gets no signature', async () => {
  assert.equal(await refusal(challenge(), null), 'sep10.error.noSigningKey');
  assert.equal(await refusal(challenge(), { webAuthEndpoint: TOML.webAuthEndpoint }), 'sep10.error.noSigningKey');
});

test('a login sourced by a key the domain does not publish is refused', async () => {
  const other = Keypair.random();
  assert.equal(await refusal(challenge({ source: other.publicKey(), signer: other })), 'sep10.error.signingKey');
});

test('a login sourced by the published key but signed by someone else is refused', async () => {
  // The source is a field anyone can write; only the key's holder can produce its signature.
  assert.equal(await refusal(challenge({ signer: Keypair.random() })), 'sep10.error.serverSignature');
});

test('a login minted by a host the domain does not name as its auth endpoint is refused', async () => {
  assert.equal(await refusal(challenge({ webAuth: 'auth.elsewhere.example' })), 'sep10.error.webAuthDomain');
  assert.equal(await refusal(challenge(), { ...TOML, webAuthEndpoint: 'https://auth.elsewhere.example/auth' }), 'sep10.error.webAuthDomain');
});

test('a login for another network is refused with a way out', async () => {
  assert.equal(await refusal(challenge(), { ...TOML, networkPassphrase: Networks.TESTNET }), 'sep10.error.otherNetwork');
});

test('a login for another account is refused', async () => {
  assert.equal(await refusal(challenge({ account: Keypair.random().publicKey() })), 'sep10.error.notOurs');
});

test('the signed login carries our signature beside the service’s, and nothing else changes', async () => {
  const xdr = challenge();
  const verified = await verifyChallenge(CFG, xdr, ME, reader(TOML), NOW);
  const signed = await signVerifiedChallenge(CFG, xdr, verified, me.secret(), async () => {
    throw new Error('the ledger is only read for a recovered account');
  });
  const tx = TransactionBuilder.fromXDR(signed, CFG.passphrase);
  assert.ok(!('innerTransaction' in tx));
  assert.equal(tx.signatures.length, 2);
  assert.equal(tx.sequence, '0');
  // Both signatures verify against their keys: the service's, and ours.
  assertServerSigned(tx as never, server.publicKey());
  assertServerSigned(tx as never, ME);
});

test('a recovered account signs with a key the ledger lists, and is refused with one it does not', async () => {
  const deviceKey = Keypair.random();
  const xdr = challenge();
  const verified = await verifyChallenge(CFG, xdr, ME, reader(TOML), NOW);
  const signed = await signVerifiedChallenge(CFG, xdr, verified, deviceKey.secret(), async () => [deviceKey.publicKey()]);
  assert.equal(TransactionBuilder.fromXDR(signed, CFG.passphrase).signatures.length, 2);
  await assert.rejects(
    signVerifiedChallenge(CFG, xdr, verified, deviceKey.secret(), async () => []),
    (e: unknown) => e instanceof Sep10Error && e.key === 'sep10.error.wrongKey',
  );
});
