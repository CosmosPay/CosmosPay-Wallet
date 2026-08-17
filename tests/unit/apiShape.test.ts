/**
 * The response-contract kit and the endpoint contracts.
 *
 * Two properties matter as much as the rejections: unknown fields must pass through
 * (an installed wallet runs weeks behind the server), and the fields the wallet acts
 * on — ids, amounts, and above all `xdr` — must be rejected when wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiShapeError, amount, arrayOf, either, id, num, object, optional, parseShape, str, variant, xdr } from '@/lib/apiShape';
import { ClaimResultShape, LiquidityOperationShape, PayoutQuoteShape, SubmitResultShape, SwapShape } from '@/lib/cosmospayShapes';

const URL_ = 'https://gw.example/v1/thing';
const G = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const XDR = 'AAAAAgAAAABxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

test('unknown fields pass through untouched', () => {
  const body = { id: 'abc', extra: 'added by a newer server', nested: { whatever: 1 } };
  const out = parseShape(URL_, object({ id }), body);
  assert.equal(out, body); // same reference — nothing stripped
  assert.equal((out as typeof body).extra, 'added by a newer server');
});

test('a declared field of the wrong type is rejected, with a path', () => {
  assert.throws(
    () => parseShape(URL_, object({ id }), { id: 42 }),
    (e: unknown) => e instanceof ApiShapeError && (e as ApiShapeError).path === 'id',
  );
  assert.throws(() => parseShape(URL_, object({ id }), { id: '' }), ApiShapeError); // empty id
  assert.throws(() => parseShape(URL_, object({ id }), null), ApiShapeError);
  assert.throws(() => parseShape(URL_, object({ id }), []), ApiShapeError);
});

test('amount accepts a decimal string and nothing else', () => {
  assert.equal(parseShape(URL_, amount, '10.5000000'), '10.5000000');
  assert.equal(parseShape(URL_, amount, '0'), '0');
  for (const bad of [10.5, '10,5', '-1', '1e3', '', 'abc', null]) {
    assert.throws(() => parseShape(URL_, amount, bad), ApiShapeError, `accepted ${JSON.stringify(bad)}`);
  }
});

test('xdr rejects the kind of string extractUnsignedXdr used to hand over', () => {
  assert.equal(parseShape(URL_, xdr, XDR), XDR);
  // Long enough to pass the old `length > 40` heuristic, not base64.
  assert.throws(() => parseShape(URL_, xdr, 'the transaction could not be built right now!!'), ApiShapeError);
  assert.throws(() => parseShape(URL_, xdr, 'AAAA'), ApiShapeError); // too short
  assert.throws(() => parseShape(URL_, xdr, null), ApiShapeError);
});

test('optional accepts absent and null alike', () => {
  const shape = object({ a: optional(num) });
  assert.doesNotThrow(() => parseShape(URL_, shape, {}));
  assert.doesNotThrow(() => parseShape(URL_, shape, { a: null }));
  assert.doesNotThrow(() => parseShape(URL_, shape, { a: 0 })); // 0 is a value, not absence
  assert.throws(() => parseShape(URL_, shape, { a: '5' }), ApiShapeError);
});

test('arrayOf reports the failing index', () => {
  assert.throws(
    () => parseShape(URL_, object({ xs: arrayOf(object({ id })) }), { xs: [{ id: 'a' }, { id: 7 }] }),
    (e: unknown) => e instanceof ApiShapeError && (e as ApiShapeError).path === 'xs[1].id',
  );
});

test('variant rejects an unrecognised discriminant instead of falling through', () => {
  assert.doesNotThrow(() => parseShape(URL_, ClaimResultShape, { status: 'pending' }));
  assert.doesNotThrow(() =>
    parseShape(URL_, ClaimResultShape, { status: 'ready', organizationId: 'org_1', keys: { dev: 'k', prod: null } }),
  );
  // A typo'd status would otherwise hit the wallet's `switch` default branch.
  assert.throws(() => parseShape(URL_, ClaimResultShape, { status: 'redy' }), ApiShapeError);
  // 'ready' without its payload is rejected too.
  assert.throws(() => parseShape(URL_, ClaimResultShape, { status: 'ready' }), ApiShapeError);
});

test('either accepts both the bare array and the enveloped form', () => {
  const shape = either(arrayOf(object({ id })), object({ data: optional(arrayOf(object({ id }))) }));
  assert.doesNotThrow(() => parseShape(URL_, shape, [{ id: 'a' }]));
  assert.doesNotThrow(() => parseShape(URL_, shape, { data: [{ id: 'a' }] }));
  assert.doesNotThrow(() => parseShape(URL_, shape, {}));
  assert.throws(() => parseShape(URL_, shape, 'nope'), ApiShapeError);
});

test('the swap contract guards the field that gets signed', () => {
  const ok = {
    id: 'swap_1',
    xdr: XDR,
    source: G,
    sendAmount: '10',
    sendAsset: 'XLM',
    destEstimated: '9.5',
    destAsset: 'USDC',
    createdAt: 'whatever the server likes',
  };
  assert.doesNotThrow(() => parseShape(URL_, SwapShape, ok));
  assert.throws(() => parseShape(URL_, SwapShape, { ...ok, xdr: null }), ApiShapeError);
  assert.throws(() => parseShape(URL_, SwapShape, { ...ok, xdr: 'not base64 at all !!!!!!!!!!!!!!!!!!!!' }), ApiShapeError);
  assert.throws(() => parseShape(URL_, SwapShape, { ...ok, source: 'not-an-account' }), ApiShapeError);
  assert.throws(() => parseShape(URL_, SwapShape, { ...ok, sendAmount: 10 }), ApiShapeError);
});

test('the liquidity operation contract guards its xdr too', () => {
  const ok = { id: 'op_1', xdr: XDR, source: G, amountA: '1', amountB: '2', shares: null };
  assert.doesNotThrow(() => parseShape(URL_, LiquidityOperationShape, ok));
  assert.throws(() => parseShape(URL_, LiquidityOperationShape, { ...ok, xdr: '' }), ApiShapeError);
});

test('submit results must actually say whether they were submitted', () => {
  assert.doesNotThrow(() =>
    parseShape(URL_, SubmitResultShape, { submitted: true, txHash: 'abc', reason: null, resultCodes: { anything: 1 } }),
  );
  assert.throws(() => parseShape(URL_, SubmitResultShape, { submitted: 'true', txHash: null, reason: null, resultCodes: null }), ApiShapeError);
});

test('payout quote amounts must be numbers — they are minor units', () => {
  assert.doesNotThrow(() => parseShape(URL_, PayoutQuoteShape, { id: 'q1', sender_amount: 150 }));
  assert.doesNotThrow(() => parseShape(URL_, PayoutQuoteShape, { id: 'q1' }));
  // A string here would sail through `quote.sender_amount / 100`.
  assert.throws(() => parseShape(URL_, PayoutQuoteShape, { id: 'q1', sender_amount: '1.50' }), ApiShapeError);
});

test('str/num/id basics', () => {
  assert.equal(parseShape(URL_, str, 'x'), 'x');
  assert.throws(() => parseShape(URL_, num, NaN), ApiShapeError);
  assert.throws(() => parseShape(URL_, num, Infinity), ApiShapeError);
  assert.throws(() => parseShape(URL_, id, '   '), ApiShapeError);
  assert.doesNotThrow(() => parseShape(URL_, variant('kind', { a: object({}) }), { kind: 'a' }));
});
