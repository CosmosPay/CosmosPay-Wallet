/**
 * The diagnostics ownership attestation.
 *
 * Two properties carry the whole thing, and both are the kind that fail silently: the
 * signature must be verifiable by anyone holding the address, and it must NEVER be usable
 * as a transaction signature. The second is what makes signing with no password prompt
 * defensible at all, so it is asserted here rather than described in a comment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks, TransactionBuilder, Account, Operation, Asset, BASE_FEE } from '@stellar/stellar-sdk';
import {
  attestationFresh,
  attestationMessage,
  signOwnership,
  verifyOwnership,
} from '@/lib/attestation';
import { signMessagePayload, SIGN_MESSAGE_DOMAIN } from '@/lib/signMessage';
import {
  ATTESTATION_DOMAIN,
  ATTESTATION_MAX_AGE_MS,
  ATTESTATION_VERSION,
} from '@/constants/telemetry';

const kp = Keypair.random();
const base = {
  secret: kp.secret(),
  address: kp.publicKey(),
  installId: 'install-abc',
  networkPassphrase: Networks.TESTNET,
};

test('a freshly signed attestation verifies against its own address', async () => {
  const a = await signOwnership(base);
  assert.equal(a.address, kp.publicKey());
  assert.equal(a.v, ATTESTATION_VERSION);
  assert.equal(await verifyOwnership(a), true);
});

test('another key cannot vouch for this address', async () => {
  // The whole point: an event stream naming an account must be signable only by it.
  const impostor = Keypair.random();
  const a = await signOwnership({ ...base, secret: impostor.secret() });
  assert.equal(await verifyOwnership({ ...a, address: kp.publicKey() }), false);
});

test('every bound field is covered by the signature', async () => {
  const a = await signOwnership(base);
  // Changing any one of them must invalidate it — otherwise a testnet attestation is
  // evidence about mainnet, or one install's proof is reusable by another.
  for (const tampered of [
    { ...a, installId: 'someone-else' },
    { ...a, network: Networks.PUBLIC },
    { ...a, issuedAt: a.issuedAt - 1 },
    { ...a, v: ATTESTATION_VERSION + 1 },
  ]) {
    assert.equal(await verifyOwnership(tampered), false, JSON.stringify(tampered).slice(0, 60));
  }
});

test('it expires, and a future timestamp is not fresh either', () => {
  const now = Date.now();
  const a = { v: 1, address: base.address, installId: 'i', network: 'n', issuedAt: now, sig: '' };
  assert.equal(attestationFresh(a, now), true);
  assert.equal(attestationFresh(a, now + ATTESTATION_MAX_AGE_MS - 1), true);
  // Expiry is what stops a no-prompt signature being a standing credential.
  assert.equal(attestationFresh(a, now + ATTESTATION_MAX_AGE_MS), false);
  // A clock ahead of ours would otherwise mint something that never ages out.
  assert.equal(attestationFresh(a, now - 1), false);
  assert.equal(attestationFresh(null, now), false);
});

test('the attestation domain is not the dapp signMessage domain', async () => {
  // If they shared a tag, a website could ask a user to "sign a message" that is really a
  // well-formed attestation and receive one. Same key, two protocols, one separator.
  assert.notEqual(ATTESTATION_DOMAIN, SIGN_MESSAGE_DOMAIN);
  const body = attestationMessage({
    v: ATTESTATION_VERSION,
    address: base.address,
    installId: base.installId,
    network: base.networkPassphrase,
    issuedAt: 1,
  });
  const asAttestation = await signMessagePayload(body, ATTESTATION_DOMAIN);
  const asMessage = await signMessagePayload(body, SIGN_MESSAGE_DOMAIN);
  assert.notDeepEqual([...asAttestation], [...asMessage]);
});

test('what it signs can never be a transaction signature', async () => {
  // The reason this may run with no password prompt. A real transaction's signature is
  // ed25519 over its 32-byte hash; the attestation signs a digest the domain prefix
  // constrains, so the two can never collide without a preimage attack — and, concretely,
  // the attestation's signature must not validate against a transaction the wallet built.
  const tx = new TransactionBuilder(new Account(kp.publicKey(), '1'), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(60)
    .build();

  const a = await signOwnership(base);
  const sig = Buffer.from(a.sig, 'base64');
  assert.equal(kp.verify(tx.hash(), sig), false);

  // And the converse: a transaction signature must not pass as an attestation.
  tx.sign(kp);
  const txSig = tx.signatures[0].signature();
  assert.equal(await verifyOwnership({ ...a, sig: Buffer.from(txSig).toString('base64') }), false);
});

test('a malformed attestation is false, never a throw', async () => {
  // It is verified on a server-ish path and built on a device one; neither may crash on a
  // value some other client wrote.
  const a = await signOwnership(base);
  assert.equal(await verifyOwnership({ ...a, address: 'not-an-address' }), false);
  assert.equal(await verifyOwnership({ ...a, sig: 'not base64 !!!' }), false);
  assert.equal(await verifyOwnership({ ...a, sig: '' }), false);
});

test('the signed body is fixed-order and unambiguous', () => {
  // A verifier rebuilds this string byte for byte, so its shape is the contract. Two
  // different claims must never produce the same body.
  const body = attestationMessage({
    v: 1,
    address: 'GABC',
    installId: 'i-1',
    network: Networks.TESTNET,
    issuedAt: 1700000000000,
  });
  assert.equal(
    body,
    ['version: 1', 'address: GABC', 'install: i-1', `network: ${Networks.TESTNET}`, 'issuedAt: 1700000000000'].join('\n'),
  );
});
