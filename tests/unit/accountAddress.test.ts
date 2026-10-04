/**
 * Which address a wallet acts as on each network. A SEP-30 re-key lands on ONE ledger; a
 * wallet that carried the recovered account to the other network would build payments its
 * key cannot sign there. These pin that the account is used only where the re-key landed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { addressOn, keyAddressOf, ledgerOfRekey, rekeyOf, rekeyOfBackup } from '@/lib/accountAddress';

const ACCOUNT = Keypair.random().publicKey();
const KEY = Keypair.random();

test('a wallet that was never re-keyed is its address on every network', () => {
  const entry = { publicKey: ACCOUNT };
  assert.equal(addressOn(entry, Networks.PUBLIC), ACCOUNT);
  assert.equal(addressOn(entry, Networks.TESTNET), ACCOUNT);
});

test('a testnet recovery keeps the account on testnet and the key’s own address on mainnet', () => {
  const entry = { publicKey: ACCOUNT, rekey: { passphrase: Networks.TESTNET, keyAddress: KEY.publicKey() } };
  assert.equal(addressOn(entry, Networks.TESTNET), ACCOUNT);
  assert.equal(addressOn(entry, Networks.PUBLIC), KEY.publicKey());
});

test('a mainnet recovery keeps the account on mainnet and the key’s own address on testnet', () => {
  const entry = { publicKey: ACCOUNT, rekey: { passphrase: Networks.PUBLIC, keyAddress: KEY.publicKey() } };
  assert.equal(addressOn(entry, Networks.PUBLIC), ACCOUNT);
  assert.equal(addressOn(entry, Networks.TESTNET), KEY.publicKey());
});

test('a re-key is recorded only when the key is not the account and the ledger is known', () => {
  assert.equal(rekeyOf(ACCOUNT, ACCOUNT, Networks.PUBLIC), undefined);
  assert.equal(rekeyOf(ACCOUNT, KEY.publicKey(), undefined), undefined);
  assert.deepEqual(rekeyOf(ACCOUNT, KEY.publicKey(), Networks.PUBLIC), { passphrase: Networks.PUBLIC, keyAddress: KEY.publicKey() });
});

test('a restored box yields the re-key it recorded, and none without an account', () => {
  const secret = KEY.secret();
  assert.equal(keyAddressOf(secret), KEY.publicKey());
  assert.equal(rekeyOfBackup({ secret }), undefined);
  assert.equal(rekeyOfBackup({ secret, account: ACCOUNT }), undefined);
  assert.deepEqual(rekeyOfBackup({ secret, account: ACCOUNT, rekeyedOn: Networks.TESTNET }), {
    passphrase: Networks.TESTNET,
    keyAddress: KEY.publicKey(),
  });
});

test('an old recovered wallet is healed only when exactly one ledger lists its key', () => {
  const key = KEY.publicKey();
  assert.equal(
    ledgerOfRekey(key, [
      { passphrase: Networks.TESTNET, signers: [key, ACCOUNT] },
      { passphrase: Networks.PUBLIC, signers: [ACCOUNT] },
    ]),
    Networks.TESTNET,
  );
  assert.equal(
    ledgerOfRekey(key, [
      { passphrase: Networks.TESTNET, signers: [key] },
      { passphrase: Networks.PUBLIC, signers: [key] },
    ]),
    undefined,
  );
  assert.equal(
    ledgerOfRekey(key, [
      { passphrase: Networks.TESTNET, signers: null },
      { passphrase: Networks.PUBLIC, signers: [ACCOUNT] },
    ]),
    undefined,
  );
});
