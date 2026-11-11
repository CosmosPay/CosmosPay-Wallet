/**
 * The one reading of a site's EVM request (`src/lib/evmReview.ts`), shared by the extension's
 * approval window and WalletConnect: which refusals it makes, and what it warns about and asks
 * the person to acknowledge.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVM_ERR } from '@/constants/evmDapp';
import { NETWORKS } from '@/constants/networks';
import { EvmDappRefused } from '@/lib/evmDapp';
import { evmFailure, evmReviewNotes, reviewEvmRequest } from '@/lib/evmReview';

const ME = '0x6b30c7d7657A83141186Cd8c155CDB90C8750371';
const OTHER = '0x1111111111111111111111111111111111111111';
const word = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const token = NETWORKS.arb.tokens[0];
const transferData = (to: string, amount: bigint) => `0xa9059cbb${word(to)}${word(amount.toString(16))}`;
const approveData = (spender: string, amount: bigint) => `0x095ea7b3${word(spender)}${word(amount.toString(16))}`;

const tx = (to: string, data: string, value = '0x0') => [{ from: ME, to, data, value }];
const review = (method: string, params: unknown, chainId = 42161, account: string | null = ME) => reviewEvmRequest({ method, params, chainId, account, env: 'mainnet' });

test('it refuses before anything else what the wallet cannot sign for', () => {
  assert.equal(review('eth_sign', []).refusalCode, EVM_ERR.unsupported);
  assert.equal(review('personal_sign', ['0x68656c6c6f', ME], 42161, null).refusalCode, EVM_ERR.unauthorized);
  // A test chain in mainnet mode, or a chain the wallet does not have.
  assert.equal(review('personal_sign', ['0x68656c6c6f', ME], 421614).refusalCode, EVM_ERR.unknownChain);
  assert.equal(review('personal_sign', ['0x68656c6c6f', ME], 130).refusalCode, EVM_ERR.unknownChain);
  // Another account than the wallet's.
  const other = review('personal_sign', ['0x68656c6c6f', OTHER]);
  assert.equal(other.refusal, 'approve.evm.err.from');
  assert.equal(other.refusalCode, EVM_ERR.unauthorized);
  // A malformed request is a refusal, never a guess.
  assert.equal(review('eth_sendTransaction', [{ from: ME, to: 'nope' }]).refusal, 'approve.evm.err.params');
});

test('a plain message and a registry token transfer need no acknowledgement', () => {
  const msg = review('personal_sign', ['0x68656c6c6f', ME]);
  assert.equal(msg.refusal, null);
  assert.equal(msg.request?.kind, 'personalSign');
  assert.deepEqual(evmReviewNotes(msg, null), { needsAck: false, warnings: [], grant: false, coversAll: false });

  const pay = review('eth_sendTransaction', tx(token.asset, transferData(OTHER, 10n)));
  assert.equal(pay.call?.kind, 'erc20');
  assert.equal(evmReviewNotes(pay, null).needsAck, false);
});

test('an allowance is acknowledged, and one that takes everything says so', () => {
  const small = review('eth_sendTransaction', tx(token.asset, approveData(OTHER, 5n)));
  assert.deepEqual(evmReviewNotes(small, 1000n).warnings.map((w) => w.key), ['approve.evm.warnAllowance']);
  assert.equal(evmReviewNotes(small, 1000n).needsAck, true);
  // At least the balance read for it, or unlimited, is everything.
  assert.deepEqual(evmReviewNotes(small, 5n).warnings.map((w) => w.key), ['approve.evm.warnUnlimited']);
  const max = review('eth_sendTransaction', tx(token.asset, approveData(OTHER, 2n ** 256n - 1n)));
  assert.equal(evmReviewNotes(max, null).coversAll, true);
});

test('a call the wallet cannot read is red and acknowledged, even when it looks like ERC-20', () => {
  const unknown = review('eth_sendTransaction', tx(OTHER, approveData(OTHER, 5n)));
  assert.equal(unknown.call?.kind, 'contract');
  const notes = evmReviewNotes(unknown, null);
  assert.equal(notes.needsAck, true);
  assert.deepEqual(notes.warnings.map((w) => w.key), ['approve.evm.warnUnknownToken']);
  const raw = review('eth_sendTransaction', tx(OTHER, '0xdeadbeef'));
  assert.deepEqual(evmReviewNotes(raw, null).warnings.map((w) => w.key), ['approve.evm.warnContract']);
});

test('typed data is parsed before it is shown, and always acknowledged', () => {
  const typed = {
    types: {
      EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }],
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    domain: { name: 'Token', chainId: 42161 },
    message: { owner: ME, spender: OTHER, value: '1' },
  };
  const r = review('eth_signTypedData_v4', [ME, JSON.stringify(typed)]);
  assert.equal(r.refusal, null);
  assert.equal(r.request?.kind, 'signTypedData');
  const notes = evmReviewNotes(r, null);
  assert.equal(notes.needsAck, true);
  assert.equal(notes.warnings[0].key, 'approve.evm.warnTypedGrant');
  // Typed data for another chain than the one named is refused.
  assert.equal(review('eth_signTypedData_v4', [ME, JSON.stringify({ ...typed, domain: { name: 'Token', chainId: 1 } })]).refusal, 'approve.evm.err.typedChain');
  // Undeclared message fields are refused by the parser, not shown.
  assert.equal(review('eth_signTypedData_v4', [ME, JSON.stringify({ ...typed, message: { ...typed.message, extra: 1 } })]).refusal !== null, true);
});

test('a failure tells the site its EIP-1193 code and an English message', () => {
  assert.deepEqual(evmFailure(new EvmDappRefused('approve.evm.err.fee', 'The network fee is above the wallet cap.', EVM_ERR.internal)), {
    code: EVM_ERR.internal,
    message: 'The network fee is above the wallet cap.',
  });
  assert.deepEqual(evmFailure(new Error('boom')), { code: EVM_ERR.internal, message: 'boom' });
});
