/**
 * The signing-confirmation gate.
 *
 * Every action that will use the key runs through `requestSignature` first. With
 * manual confirmations on, it shows a password prompt and resolves only once the
 * password verifies; with them off it resolves immediately — except when `force` is
 * set, which is how security-critical actions (including turning the toggle itself
 * off) stay gated regardless.
 *
 * Its own slice because it is a small state machine whose correctness matters more
 * than its size, and because it was previously interleaved with profile editing in
 * the middle of the store — `resolveConfirm` sat eighty lines below the request it
 * resolves.
 *
 * FIXED HERE: a single resolver ref meant two concurrent gated actions (a double tap,
 * or the claim poller firing while the user confirms) overwrote each other and left
 * the first promise pending forever. Requests now queue.
 */
import { useCallback, useRef, useState } from 'react';
import { savedRequireConfirm } from '@/state/usePreferences';

export interface ConfirmRequest {
  title: string;
  message?: string;
}

export function useSigningGate() {
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  /** Pending requests, oldest first. More than one is rare but must not deadlock. */
  const queue = useRef<{ opts: ConfirmRequest; resolve: (ok: boolean) => void }[]>([]);

  const pump = useCallback(() => {
    setConfirmReq(queue.current[0]?.opts ?? null);
  }, []);

  const requestSignature = useCallback(
    (opts: ConfirmRequest, force = false): Promise<boolean> => {
      // Read the persisted flag, not React state: this must reflect the value at the
      // moment of the action, even if the toggle changed in the same tick.
      if (!force && !savedRequireConfirm()) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        queue.current.push({ opts, resolve });
        pump();
      });
    },
    [pump],
  );

  /** Called by the confirmation UI with the user's answer. */
  const resolveConfirm = useCallback(
    (ok: boolean) => {
      const current = queue.current.shift();
      current?.resolve(ok);
      pump();
    },
    [pump],
  );

  /**
   * Answer every pending request with "no" and clear the queue.
   *
   * `lock()` calls this. Without it an auto-lock left the prompt on screen over the
   * unlock form and the awaiting flow still holding the pre-lock draft — a session
   * that ended must not leave a signature waiting to be granted.
   */
  const cancelPending = useCallback(() => {
    const pending = queue.current;
    queue.current = [];
    for (const p of pending) p.resolve(false);
    pump();
  }, [pump]);

  return { confirmReq, requestSignature, resolveConfirm, cancelPending };
}
