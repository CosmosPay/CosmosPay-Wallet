/**
 * Retry a call whose failure never reached the server.
 *
 * NOT a general retry: CLAUDE.md keeps `retry` to idempotent GETs, because a repeated
 * payout is a duplicate payment. This exists for the one write where NOT repeating is the
 * worse outcome — `recoverWallet`'s `finishSignIn`, which runs after a new key is already
 * on the ledger and is the only thing that saves it. An `ApiRequestError` is the server's
 * answer and is thrown at once; only a failure with no HTTP answer is tried again.
 */
import { ApiRequestError } from '@/lib/apiError';
import { NETWORK_RETRY_ATTEMPTS, NETWORK_RETRY_BASE_MS } from '@/constants/api';

export async function retryOnNetworkError<T>(
  fn: () => Promise<T>,
  attempts = NETWORK_RETRY_ATTEMPTS,
  baseMs = NETWORK_RETRY_BASE_MS,
): Promise<T> {
  for (let n = 1; ; n += 1) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiRequestError || n >= attempts) throw e;
      await new Promise((r) => setTimeout(r, baseMs * n));
    }
  }
}
