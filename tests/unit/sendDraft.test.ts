/**
 * The send draft. The regression: a scanned or pasted request was MERGED into the draft, so a
 * SEP-7 link abandoned with an amount of 2 and the memo "sep7-check", then a QR of a plain
 * address, opened Send on the new address with the old amount and memo (e2e run, 2026-11-24).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftFromRequest, emptySendDraft, sendsToSelf } from '@/lib/sendDraft';
import { parseStellarQr } from '@/lib/sep7';
import { XLM } from '@/lib/asset';

const DEST = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const OTHER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const draftOf = (raw: string) => {
  const req = parseStellarQr(raw);
  assert.ok(req, `parses: ${raw}`);
  return draftFromRequest(req);
};

test('a plain address after an abandoned request starts an empty draft', () => {
  const abandoned = draftOf(`web+stellar:pay?destination=${OTHER}&amount=2&memo=sep7-check&asset_code=USDC&asset_issuer=${ISSUER}`);
  assert.equal(abandoned.amount, '2');
  assert.equal(abandoned.memo, 'sep7-check');
  // The next scan does not see the draft at all: nothing of it can ride along.
  assert.deepEqual(draftOf(DEST), { ...emptySendDraft(), to: DEST });
});

test('a request fills every field it names, and empties the rest', () => {
  const full = draftOf(`web+stellar:pay?destination=${DEST}&amount=10&memo=123&memo_type=MEMO_ID&asset_code=USDC&asset_issuer=${ISSUER}`);
  assert.deepEqual(full, { to: DEST, amount: '10', memo: '123', memoKind: 'id', asset: { code: 'USDC', issuer: ISSUER } });
  const amountOnly = draftOf(`web+stellar:pay?destination=${DEST}&amount=3`);
  assert.deepEqual(amountOnly, { to: DEST, amount: '3', memo: '', memoKind: 'text', asset: XLM });
});

test('the memo is clamped by bytes, a code without its issuer is XLM, and a lone memo type is no memo', () => {
  const long = draftOf(`web+stellar:pay?destination=${DEST}&memo=${encodeURIComponent('ñ'.repeat(20))}`);
  assert.equal(new TextEncoder().encode(long.memo).length, 28);
  assert.deepEqual(draftOf(`web+stellar:pay?destination=${DEST}&asset_code=USDC`).asset, XLM);
  assert.equal(draftOf(`web+stellar:pay?destination=${DEST}&memo_type=MEMO_ID`).memoKind, 'text');
});

test('sending to yourself is recognised as each network spells an address', () => {
  assert.equal(sendsToSelf('stellar', DEST, DEST), true);
  assert.equal(sendsToSelf('stellar', ` ${DEST} `, DEST), true);
  assert.equal(sendsToSelf('stellar', OTHER, DEST), false);
  // An EVM address is the same in any case; a Stellar one is not case-folded.
  assert.equal(sendsToSelf('eth', '0xAbC0000000000000000000000000000000000001', '0xabc0000000000000000000000000000000000001'), true);
  assert.equal(sendsToSelf('stellar', DEST.toLowerCase(), DEST), false);
  // No address of our own, or nothing typed: never "yourself".
  assert.equal(sendsToSelf('stellar', DEST, null), false);
  assert.equal(sendsToSelf('stellar', '', DEST), false);
});
