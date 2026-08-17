/**
 * SEP-7 parsing. The regression: a malformed `pay` fell through to a loose scan of
 * the whole URI, so attacker-controlled fields like `msg` could supply the
 * destination — and the address shape was checked without its CRC-16 checksum.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSep7Pay, parseStellarQr } from '@/lib/sep7';

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
