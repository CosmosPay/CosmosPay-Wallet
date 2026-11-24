/**
 * SEP-7 parsing. The regression: a malformed `pay` fell through to a loose scan of
 * the whole URI, so attacker-controlled fields like `msg` could supply the
 * destination — and the address shape was checked without its CRC-16 checksum.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Networks } from '@stellar/stellar-sdk';
import { buildSep7Pay, isForOtherNetwork, parseStellarQr, readPaymentRequest } from '@/lib/sep7';

const DEST = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const ATTACKER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

test('a well-formed pay link parses fully', () => {
  const parsed = parseStellarQr(`web+stellar:pay?destination=${DEST}&amount=10&memo=123&memo_type=MEMO_ID&asset_code=USDC&asset_issuer=${ISSUER}`);
  assert.equal(parsed?.destination, DEST);
  assert.equal(parsed?.amount, '10');
  assert.equal(parsed?.memo, '123');
  assert.equal(parsed?.memoType, 'MEMO_ID');
  assert.equal(parsed?.assetCode, 'USDC');
  assert.equal(parsed?.assetIssuer, ISSUER);
});

test('a malformed pay link is rejected, not scanned for a loose address', () => {
  // The old fall-through picked the attacker's address out of `msg`.
  const hostile = `web+stellar:pay?destination=NOTANADDRESS&msg=${ATTACKER}`;
  assert.equal(parseStellarQr(hostile), null);
});

test('a tx op is not mined for an address either', () => {
  assert.equal(parseStellarQr(`web+stellar:tx?xdr=AAAA&msg=${ATTACKER}`), null);
});

test('an address failing its checksum is rejected', () => {
  // Same shape (G + 55 base32 chars), one character changed -> bad CRC.
  const corrupted = DEST.slice(0, -1) + (DEST.at(-1) === 'A' ? 'B' : 'A');
  assert.equal(corrupted.length, DEST.length);
  assert.equal(parseStellarQr(corrupted), null);
});

test('a bare address still works', () => {
  assert.equal(parseStellarQr(DEST)?.destination, DEST);
  assert.equal(parseStellarQr(`stellar:${DEST}`)?.destination, DEST);
  assert.equal(parseStellarQr('  ' + DEST + '  ')?.destination, DEST);
});

test('an asset code without a valid issuer drops the issuer', () => {
  const parsed = parseStellarQr(`web+stellar:pay?destination=${DEST}&asset_code=USDC&asset_issuer=garbage`);
  assert.equal(parsed?.assetCode, 'USDC');
  assert.equal(parsed?.assetIssuer, undefined);
});

test('build -> parse round trip preserves the memo type', () => {
  const uri = buildSep7Pay({ destination: DEST, amount: '5', memo: '99', memoType: 'MEMO_ID' });
  const parsed = parseStellarQr(uri);
  assert.equal(parsed?.destination, DEST);
  assert.equal(parsed?.memo, '99');
  assert.equal(parsed?.memoType, 'MEMO_ID');
});

test('garbage yields null', () => {
  assert.equal(parseStellarQr('hello world'), null);
  assert.equal(parseStellarQr(''), null);
});

/*
 * The network a request is for. SEP-7 reads a link WITHOUT `network_passphrase` as a public
 * network request, so the wallet's testnet Receive QR (which left it out) had another wallet
 * build a mainnet payment from it.
 */

test('a testnet request names its network; a public one is left as SEP-7 reads it', () => {
  const testnet = buildSep7Pay({ destination: DEST, networkPassphrase: Networks.TESTNET });
  assert.equal(new URLSearchParams(testnet.slice(testnet.indexOf('?') + 1)).get('network_passphrase'), Networks.TESTNET);
  assert.equal(parseStellarQr(testnet)?.networkPassphrase, Networks.TESTNET);
  // Percent-encoded, so a reader using decodeURIComponent gets the same passphrase back.
  const raw = testnet.slice(testnet.indexOf('network_passphrase=') + 'network_passphrase='.length);
  assert.equal(decodeURIComponent(raw), Networks.TESTNET);
  assert.equal(parseStellarQr(buildSep7Pay({ destination: DEST, memo: 'a+b c' }))?.memo, 'a+b c');
  const pub = buildSep7Pay({ destination: DEST, networkPassphrase: Networks.PUBLIC });
  assert.ok(!pub.includes('network_passphrase'), 'the public network is SEP-7’s default, so it is left out');
  assert.equal(parseStellarQr(pub)?.networkPassphrase, undefined);
  // A custom network's own passphrase is named like testnet's.
  const custom = 'Private Network ; 2026';
  assert.equal(parseStellarQr(buildSep7Pay({ destination: DEST, networkPassphrase: custom }))?.networkPassphrase, custom);
});

test('a request for another network is refused, both ways', () => {
  const testnetLink = buildSep7Pay({ destination: DEST, amount: '5', networkPassphrase: Networks.TESTNET });
  const publicLink = `web+stellar:pay?destination=${DEST}&amount=5&network_passphrase=${encodeURIComponent(Networks.PUBLIC)}`;
  // A testnet request read by a mainnet wallet would pay real money for a test request.
  assert.deepEqual(readPaymentRequest(testnetLink, Networks.PUBLIC), { ok: false, reason: 'otherNetwork' });
  // A mainnet request read by a testnet wallet would never pay its payee.
  assert.deepEqual(readPaymentRequest(publicLink, Networks.TESTNET), { ok: false, reason: 'otherNetwork' });
  // Each on its own network goes through.
  assert.equal(readPaymentRequest(testnetLink, Networks.TESTNET).ok, true);
  assert.equal(readPaymentRequest(publicLink, Networks.PUBLIC).ok, true);
  assert.equal(isForOtherNetwork({ networkPassphrase: Networks.TESTNET }, Networks.PUBLIC), true);
});

test('a request that names no network is read on the wallet’s, and a broken one stays invalid', () => {
  const unnamed = buildSep7Pay({ destination: DEST, amount: '5' });
  assert.equal(readPaymentRequest(unnamed, Networks.TESTNET).ok, true);
  assert.equal(readPaymentRequest(unnamed, Networks.PUBLIC).ok, true);
  assert.equal(readPaymentRequest(DEST, Networks.TESTNET).ok, true, 'a bare address names no network');
  assert.deepEqual(readPaymentRequest('web+stellar:pay?destination=nope', Networks.TESTNET), { ok: false, reason: 'invalid' });
});
