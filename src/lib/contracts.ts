/**
 * API Response Contracts.
 * 
 * Contracts assert ONLY the fields the wallet acts on (ids, amounts, XDRs, statuses).
 * Unknown fields pass through on purpose so that older wallet releases do not break
 * when the server adds new fields.
 * 
 * If a contract fires in production, the documented remedy is to LOOSEN that field
 * (or make it optional if it disappeared) — not to delete the check.
 */

import type {
  RegisterResult, ClaimResult, LinkStartResult, LinkVerifyResult,
  SwapQuote, Swap, SubmitResult, LiquidityPoolList, LiquidityPool,
  LiquidityPositionList, LiquidityOperation, LiquiditySubmitResult,
  PayIntent, Receiver, RegisteredWallet, BankAccount, PayinQuote,
  Payin, PayoutQuote, Payout,
} from './cosmospay';

export function assertObject(val: unknown, typeName: string): Record<string, unknown> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    throw new Error(`Contract violation: expected ${typeName} to be an object, got ${typeof val}`);
  }
  return val as Record<string, unknown>;
}

export function assertString(val: unknown, field: string): string {
  if (typeof val !== 'string') {
    throw new Error(`Contract violation: missing or invalid string field '${field}'`);
  }
  return val;
}

export function assertNumber(val: unknown, field: string): number {
  if (typeof val !== 'number') {
    throw new Error(`Contract violation: missing or invalid number field '${field}'`);
  }
  return val;
}

export function assertBoolean(val: unknown, field: string): boolean {
  if (typeof val !== 'boolean') {
    throw new Error(`Contract violation: missing or invalid boolean field '${field}'`);
  }
  return val;
}

export function assertArray(val: unknown, field: string): unknown[] {
  if (!Array.isArray(val)) {
    throw new Error(`Contract violation: missing or invalid array field '${field}'`);
  }
  return val;
}

// ---------------- Provisioning ----------------

export const contractRegisterResult = (v: unknown): RegisterResult => {
  const o = assertObject(v, 'RegisterResult');
  const status = assertString(o.status, 'status');
  if (status === 'pending') {
    assertString(o.claimToken, 'claimToken');
    assertNumber(o.expiresInSeconds, 'expiresInSeconds');
  }
  return o as unknown as RegisterResult;
};

export const contractClaimResult = (v: unknown): ClaimResult => {
  const o = assertObject(v, 'ClaimResult');
  const status = assertString(o.status, 'status');
  if (status === 'ready') {
    assertString(o.organizationId, 'organizationId');
    const keys = assertObject(o.keys, 'keys');
    if (keys.dev !== null) assertString(keys.dev, 'keys.dev');
    if (keys.prod !== null) assertString(keys.prod, 'keys.prod');
  }
  return o as unknown as ClaimResult;
};

export const contractLinkStartResult = (v: unknown): LinkStartResult => {
  const o = assertObject(v, 'LinkStartResult');
  const status = assertString(o.status, 'status');
  if (status === 'sent') {
    assertString(o.claimToken, 'claimToken');
    assertNumber(o.expiresInSeconds, 'expiresInSeconds');
  }
  return o as unknown as LinkStartResult;
};

export const contractLinkVerifyResult = (v: unknown): LinkVerifyResult => {
  const o = assertObject(v, 'LinkVerifyResult');
  const status = assertString(o.status, 'status');
  if (status === 'ready') {
    assertString(o.organizationId, 'organizationId');
    const keys = assertObject(o.keys, 'keys');
    if (keys.dev !== null) assertString(keys.dev, 'keys.dev');
    if (keys.prod !== null) assertString(keys.prod, 'keys.prod');
  }
  if (status === 'invalid') {
    assertNumber(o.attemptsLeft, 'attemptsLeft');
  }
  return o as unknown as LinkVerifyResult;
};

// ---------------- Swaps ----------------

export const contractSwapQuote = (v: unknown): SwapQuote => {
  const o = assertObject(v, 'SwapQuote');
  assertString(o.network, 'network');
  const src = assertObject(o.source, 'source');
  assertString(src.asset, 'source.asset');
  assertString(src.amount, 'source.amount');
  const dest = assertObject(o.destination, 'destination');
  assertString(dest.asset, 'destination.asset');
  assertString(dest.estimated, 'destination.estimated');
  assertNumber(dest.slippageBps, 'destination.slippageBps');
  assertArray(o.path, 'path');
  return o as unknown as SwapQuote;
};

export const contractSwap = (v: unknown): Swap => {
  const o = assertObject(v, 'Swap');
  assertString(o.id, 'id');
  assertString(o.status, 'status');
  assertString(o.network, 'network');
  assertString(o.sendAmount, 'sendAmount');
  assertString(o.destEstimated, 'destEstimated');
  assertString(o.xdr, 'xdr');
  return o as unknown as Swap;
};

export const contractSubmitResult = (v: unknown): SubmitResult => {
  const o = assertObject(v, 'SubmitResult');
  assertBoolean(o.submitted, 'submitted');
  assertString(o.status, 'status');
  contractSwap(o.swap);
  return o as unknown as SubmitResult;
};

// ---------------- Liquidity ----------------

export const contractLiquidityPoolList = (v: unknown): LiquidityPoolList => {
  const o = assertObject(v, 'LiquidityPoolList');
  assertArray(o.data, 'data');
  return o as unknown as LiquidityPoolList;
};

export const contractLiquidityPool = (v: unknown): LiquidityPool => {
  const o = assertObject(v, 'LiquidityPool');
  assertString(o.id, 'id');
  assertArray(o.reserves, 'reserves');
  return o as unknown as LiquidityPool;
};

export const contractLiquidityPositionList = (v: unknown): LiquidityPositionList => {
  const o = assertObject(v, 'LiquidityPositionList');
  assertArray(o.data, 'data');
  return o as unknown as LiquidityPositionList;
};

export const contractLiquidityOperation = (v: unknown): LiquidityOperation => {
  const o = assertObject(v, 'LiquidityOperation');
  assertString(o.id, 'id');
  assertString(o.kind, 'kind');
  assertString(o.status, 'status');
  assertString(o.poolId, 'poolId');
  assertString(o.amountA, 'amountA');
  assertString(o.amountB, 'amountB');
  assertString(o.xdr, 'xdr');
  return o as unknown as LiquidityOperation;
};

export const contractLiquiditySubmitResult = (v: unknown): LiquiditySubmitResult => {
  const o = assertObject(v, 'LiquiditySubmitResult');
  assertBoolean(o.submitted, 'submitted');
  assertString(o.status, 'status');
  contractLiquidityOperation(o.operation);
  return o as unknown as LiquiditySubmitResult;
};

// ---------------- Pay Links ----------------

export const contractPayIntent = (v: unknown): PayIntent => {
  const o = assertObject(v, 'PayIntent');
  assertString(o.id, 'id');
  assertString(o.status, 'status');
  assertString(o.uri, 'uri');
  assertString(o.qr, 'qr');
  return o as unknown as PayIntent;
};

// ---------------- Fiat (BlindPay) ----------------

export const contractReceiver = (v: unknown): Receiver => {
  const o = assertObject(v, 'Receiver');
  assertString(o.id, 'id');
  assertString(o.email, 'email');
  assertString(o.country, 'country');
  return o as unknown as Receiver;
};

export const contractReceiverArray = (v: unknown): Receiver[] => {
  const arr = Array.isArray(v) ? v : (v as Record<string, unknown>).data ?? [];
  assertArray(arr, 'ReceiverArray');
  return (arr as unknown[]).map(contractReceiver);
};

export const contractRegisteredWallet = (v: unknown): RegisteredWallet => {
  const o = assertObject(v, 'RegisteredWallet');
  assertString(o.id, 'id');
  assertString(o.network, 'network');
  return o as unknown as RegisteredWallet;
};

export const contractRegisteredWalletArray = (v: unknown): RegisteredWallet[] => {
  const arr = Array.isArray(v) ? v : (v as Record<string, unknown>).data ?? [];
  assertArray(arr, 'RegisteredWalletArray');
  return (arr as unknown[]).map(contractRegisteredWallet);
};

export const contractBankAccount = (v: unknown): BankAccount => {
  const o = assertObject(v, 'BankAccount');
  assertString(o.id, 'id');
  return o as unknown as BankAccount;
};

export const contractBankAccountArray = (v: unknown): BankAccount[] => {
  const arr = Array.isArray(v) ? v : (v as Record<string, unknown>).data ?? [];
  assertArray(arr, 'BankAccountArray');
  return (arr as unknown[]).map(contractBankAccount);
};

export const contractPayinQuote = (v: unknown): PayinQuote => {
  const o = assertObject(v, 'PayinQuote');
  assertString(o.id, 'id');
  return o as unknown as PayinQuote;
};

export const contractPayin = (v: unknown): Payin => {
  const o = assertObject(v, 'Payin');
  assertString(o.id, 'id');
  return o as unknown as Payin;
};

export const contractPayoutQuote = (v: unknown): PayoutQuote => {
  const o = assertObject(v, 'PayoutQuote');
  assertString(o.id, 'id');
  return o as unknown as PayoutQuote;
};

export const contractPayout = (v: unknown): Payout => {
  const o = assertObject(v, 'Payout');
  assertString(o.id, 'id');
  return o as unknown as Payout;
};

export const contractGenericRecord = (v: unknown): Record<string, unknown> => {
  return assertObject(v, 'Record<string, unknown>');
};

export const contractMessageObject = (v: unknown): { message: string } => {
  const o = assertObject(v, '{ message: string }');
  assertString(o.message, 'message');
  return o as { message: string };
};

export const contractUrlObject = (v: unknown): { url?: string } => {
  const o = assertObject(v, '{ url?: string }');
  if (o.url !== undefined) {
    assertString(o.url, 'url');
  }
  return o as { url?: string };
};

export const contractFileUrl = (v: unknown): { file_url: string } => {
  const o = assertObject(v, '{ file_url: string }');
  assertString(o.file_url, 'file_url');
  return o as { file_url: string };
};
