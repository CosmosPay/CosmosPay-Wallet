/**
 * Endpoint + input rules. A custom network's Horizon receives every signed envelope
 * the wallet submits on that network, so cleartext http there is not a style issue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_RE, horizonUrlProblem, isSafeHorizonUrl } from '@/lib/validate';

test('https is required for a remote Horizon', () => {
  assert.ok(isSafeHorizonUrl('https://horizon.stellar.org'));
  assert.ok(isSafeHorizonUrl('https://horizon-futurenet.stellar.org/'));
  assert.ok(!isSafeHorizonUrl('http://horizon.evil.example'));
  assert.ok(!isSafeHorizonUrl('ftp://horizon.stellar.org'));
  assert.ok(!isSafeHorizonUrl('horizon.stellar.org')); // no scheme -> not a URL
  assert.ok(!isSafeHorizonUrl(''));
});

test('loopback may stay cleartext so a local node still works', () => {
  assert.ok(isSafeHorizonUrl('http://localhost:8000'));
  assert.ok(isSafeHorizonUrl('http://127.0.0.1:8000'));
  assert.ok(!isSafeHorizonUrl('http://localhost.evil.example'));
});

test('the rejection says why', () => {
  assert.equal(horizonUrlProblem(''), null); // incomplete, not wrong
  assert.equal(horizonUrlProblem('https://ok.example'), null);
  assert.match(String(horizonUrlProblem('http://remote.example')), /https:\/\//);
  assert.match(String(horizonUrlProblem('nonsense')), /URL válida/);
});

test('email rule', () => {
  assert.ok(EMAIL_RE.test('a@b.co'));
  assert.ok(!EMAIL_RE.test('a@b'));
  assert.ok(!EMAIL_RE.test('a b@c.co'));
  assert.ok(!EMAIL_RE.test('@b.co'));
});
