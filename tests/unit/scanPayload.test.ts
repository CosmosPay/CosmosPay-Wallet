/**
 * What the scanner says about a QR it read and cannot open. The regression: uploading the QR of
 * an EVM address did nothing at all, no navigation and no error (e2e run, 2026-11-24).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanRefusal, scannedAddress } from '@/lib/scanPayload';

const EVM = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

test('an address of another network is named as one', () => {
  assert.equal(scanRefusal(EVM, 'testnet'), 'otherNetwork');
  assert.equal(scanRefusal(EVM.toLowerCase(), 'mainnet'), 'otherNetwork');
  // The payment URIs other wallets put in their QR codes.
  assert.equal(scanRefusal(`ethereum:${EVM}@11155111?value=1e15`, 'testnet'), 'otherNetwork');
  assert.equal(scanRefusal('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.01', 'mainnet'), 'otherNetwork');
});

test('anything else is refused as something the scanner does not read', () => {
  assert.equal(scanRefusal('https://example.com/pay', 'mainnet'), 'unsupported');
  assert.equal(scanRefusal('hello world', 'mainnet'), 'unsupported');
  // A bare word is a valid NEAR account name; it says nothing about what the QR holds.
  assert.equal(scanRefusal('hello', 'mainnet'), 'unsupported');
  assert.equal(scanRefusal('', 'mainnet'), 'unsupported');
  // A Stellar address is the scanner's own business, never "another network".
  assert.equal(scanRefusal('GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6', 'mainnet'), 'unsupported');
});

test('the address is read out of a payment URI', () => {
  assert.equal(scannedAddress(`ethereum:${EVM}@1?value=1`), EVM);
  assert.equal(scannedAddress(`  ${EVM}  `), EVM);
  assert.equal(scannedAddress('tron:TXYZ?amount=1'), 'TXYZ');
});
