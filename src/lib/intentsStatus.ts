/**
 * Where a NEAR Intents swap stands, read straight from 1Click by its deposit address.
 *
 * Why not the gateway: `GET /v1/cross-chain-swaps/:id` is account-only, and it should stay
 * that way — on the shared public key every anonymous wallet is the same consumer. The wallet
 * already holds the one thing 1Click needs, the deposit address it just paid, and 1Click's
 * status endpoint is public and CORS-open. Read-only: nothing here can move a swap.
 *
 * The answer is DISPLAY. The swap's outcome is decided on-chain by NEAR Intents; a status
 * that lied could only make the tracker on screen wrong, never send money anywhere.
 */
import { CHAIN_RPC_TIMEOUT_MS } from '@/constants/chains';
import { INTENTS_STATUS_URL } from '@/constants/backends';

/** 1Click's execution statuses (`GetExecutionStatusResponse.status`). */
export const INTENTS_STATUSES = [
  'PENDING_DEPOSIT',
  'KNOWN_DEPOSIT_TX',
  'INCOMPLETE_DEPOSIT',
  'PROCESSING',
  'SUCCESS',
  'REFUNDED',
  'FAILED',
] as const;
export type IntentsStatus = (typeof INTENTS_STATUSES)[number];

export interface IntentsProgress {
  status: IntentsStatus;
  /** What actually arrived, once known (decimal, destination asset units). */
  amountOut: string | null;
  /** The destination chain's transaction(s), once paid out. */
  destinationTx: { hash: string; explorerUrl: string | null }[];
}

/**
 * The tracker's four steps: deposit sent → deposit seen → swapping → delivered. `done` is
 * how many are complete; `outcome` is set once the swap can no longer change.
 */
export interface TrackerState {
  done: 0 | 1 | 2 | 3 | 4;
  outcome: 'ok' | 'refunded' | 'failed' | null;
}

/** The step a status puts the tracker on. The deposit transaction itself is step 1, done. */
export function trackerState(status: IntentsStatus): TrackerState {
  switch (status) {
    case 'PENDING_DEPOSIT':
      return { done: 1, outcome: null };
    case 'KNOWN_DEPOSIT_TX':
    case 'INCOMPLETE_DEPOSIT':
      return { done: 2, outcome: null };
    case 'PROCESSING':
      return { done: 3, outcome: null };
    case 'SUCCESS':
      return { done: 4, outcome: 'ok' };
    case 'REFUNDED':
      return { done: 4, outcome: 'refunded' };
    case 'FAILED':
      return { done: 4, outcome: 'failed' };
  }
}

const isStatus = (v: unknown): v is IntentsStatus => typeof v === 'string' && (INTENTS_STATUSES as readonly string[]).includes(v);

/**
 * Parse 1Click's status body. Anything that is not one of its statuses is `null` — "not
 * known yet", which the tracker treats as "still waiting", never as an outcome.
 */
export function parseIntentsStatus(body: unknown): IntentsProgress | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { status?: unknown; swapDetails?: Record<string, unknown> };
  if (!isStatus(b.status)) return null;
  const details = b.swapDetails ?? {};
  const amountOut = typeof details.amountOutFormatted === 'string' && details.amountOut !== '0' ? details.amountOutFormatted : null;
  const txs = Array.isArray(details.destinationChainTxHashes) ? details.destinationChainTxHashes : [];
  return {
    status: b.status,
    amountOut,
    destinationTx: txs
      .filter((t): t is { hash: string; explorerUrl?: unknown } => !!t && typeof (t as { hash?: unknown }).hash === 'string')
      .map((t) => ({ hash: t.hash, explorerUrl: typeof t.explorerUrl === 'string' && t.explorerUrl.startsWith('https://') ? t.explorerUrl : null })),
  };
}

/** Ask 1Click where the swap paying `depositAddress` (and `memo`, on Stellar) stands. */
export async function fetchIntentsStatus(depositAddress: string, memo: string | null): Promise<IntentsProgress | null> {
  const query = new URLSearchParams({ depositAddress });
  if (memo) query.set('depositMemo', memo);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAIN_RPC_TIMEOUT_MS);
  try {
    const res = await fetch(`${INTENTS_STATUS_URL}?${query.toString()}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return parseIntentsStatus(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
