/**
 * The signing-confirmation gate.
 *
 * Every action that will use the key runs through `requestSignature` first. With manual
 * confirmations on, it shows a password prompt and resolves only once the password
 * verifies; with them off it resolves immediately — except when `force` is set, which is
 * how security-critical actions (including turning the toggle itself off) stay gated
 * regardless.
 *
 * Its own slice because it is a small state machine whose correctness matters more than
 * its size, and because it was previously interleaved with profile editing in the middle
 * of the store — `resolveConfirm` sat eighty lines below the request it resolves.
 *
 * FIXED HERE: a single resolver ref meant two concurrent gated actions (a double tap, or
 * the claim poller firing while the user confirms) overwrote each other and left the first
 * promise pending forever. Requests now queue.
 *
 * ALSO FIXED HERE: the queue was resolved BY POSITION — `resolveConfirm(ok)` popped
 * whatever was at the head. Answering a prompt takes an unbounded amount of wall-clock
 * (verifying a password is ~200ms of PBKDF2; an OS biometric sheet can sit open for
 * minutes and generates no input events, so the idle auto-lock can fire underneath it and
 * `cancelPending()` can empty the queue). A late answer then landed on whichever request
 * happened to be at the head by then — granting a signature the user never looked at. So
 * a request now carries an `id`, `confirmReq` carries it too, and an answer that does not
 * match the current head is discarded. The id is required, not optional: a caller that
 * cannot name what it is answering must not be able to answer.
 */
import { useCallback, useRef, useState } from 'react';

export interface ConfirmRequest {
  /** Identifies THIS prompt. Pass it back to `resolveConfirm`. */
  id: number;
  title: string;
  message?: string;
}

export function useSigningGate(requireConfirm: boolean) {
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  /** Pending requests, oldest first. More than one is rare but must not deadlock. */
  const queue = useRef<{ req: ConfirmRequest; resolve: (ok: boolean) => void }[]>([]);
  const nextId = useRef(1);

  const requireConfirmRef = useRef(requireConfirm);
  requireConfirmRef.current = requireConfirm;

  const pump = useCallback(() => {
    setConfirmReq(queue.current[0]?.req ?? null);
  }, []);

  const requestSignature = useCallback(
    (opts: Omit<ConfirmRequest, 'id'>, force = false): Promise<boolean> => {
      // Read the React state ref, not localStorage directly. This stops an attacker
      // from bypassing the password prompt by writing 'off' to localStorage.
      if (!force && !requireConfirmRef.current) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        queue.current.push({ req: { ...opts, id: nextId.current++ }, resolve });
        pump();
      });
    },
    [pump],
  );

  /**
   * Called by the confirmation UI with the user's answer.
   *
   * Returns false when the answer was discarded — the prompt it belongs to is no longer
   * the one waiting, because it was cancelled (an auto-lock) or already answered (a double
   * tap racing an OS sheet). Callers use that to avoid reporting success for a signature
   * that was never granted.
   */
  const resolveConfirm = useCallback(
    (ok: boolean, id: number): boolean => {
      if (queue.current[0]?.req.id !== id) return false;
      const current = queue.current.shift();
      current?.resolve(ok);
      pump();
      return true;
    },
    [pump],
  );

  /**
   * Answer every pending request with "no" and clear the queue.
   *
   * `lock()` calls this. Without it an auto-lock left the prompt on screen over the unlock
   * form and the awaiting flow still holding the pre-lock draft — a session that ended must
   * not leave a signature waiting to be granted.
   */
  const cancelPending = useCallback(() => {
    const pending = queue.current;
    queue.current = [];
    for (const p of pending) p.resolve(false);
    pump();
  }, [pump]);

  return { confirmReq, requestSignature, resolveConfirm, cancelPending };
}
