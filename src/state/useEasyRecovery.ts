import { useCallback, useRef, useState } from 'react';
import { ApiRequestError } from '@/lib/apiError';
import {
  easyRecoveryClaim,
  easyRecoveryOffer,
  easyRecoveryOpen,
  easyRecoveryStatus,
} from '@/lib/cosmospay';
import {
  encodeLink,
  newCode,
  newReceiver,
  openPayload,
  sealPayload,
  type EasyRecoveryLink,
  type EasyRecoveryPayload,
} from '@/lib/easyRecovery';
import { reportError } from '@/lib/telemetry';
import { EVENT } from '@/constants/telemetry';
import { EASY_RECOVERY_MAX_ATTEMPTS } from '@/constants/easyRecovery';

/** Why a session can no longer be used. Each one is said on the screen, never by moving off it. */
export type EasyRecoveryEnding = 'expired' | 'burned' | 'failed';

/** The NEW device's side: the QR it shows and what the server says about it. */
export interface EasyRecoveryReceive {
  id: string;
  /** What the QR encodes (and the link it offers to copy): the session and the PUBLIC key. */
  link: string;
  expiresAt: number;
  status: 'open' | 'offered' | 'ended';
  ending: EasyRecoveryEnding | null;
  attemptsLeft: number;
}

/** The OLD device's side: the code it shows and whether the other device took the wallet. */
export interface EasyRecoverySend {
  id: string;
  code: string;
  expiresAt: number;
  status: 'offered' | 'claimed' | 'ended';
  ending: EasyRecoveryEnding | null;
}

/** A claim that did not hand the payload over. */
export type EasyRecoveryClaimFailure = 'wrongCode' | 'notYet' | 'ended';

/** The server answers a session it no longer has (expired, claimed, burned) with one of these. */
const isGone = (e: unknown) => e instanceof ApiRequestError && (e.status === 404 || e.status === 410);

/**
 * Easy recovery's two halves (src/lib/easyRecovery.ts), one per device. The store wires them
 * to the vault (what the old device seals) and to the import (what the new one does with it).
 *
 * The receiver's private key lives in a ref, never in state: nothing renders it, nothing
 * persists it, and it is wiped the moment the session ends either way.
 */
export function useEasyRecovery(accessKey: () => Promise<string | null>) {
  const receiverRef = useRef<{ id: string; secret: Uint8Array } | null>(null);
  const [receive, setReceive] = useState<EasyRecoveryReceive | null>(null);
  const [send, setSend] = useState<EasyRecoverySend | null>(null);

  const wipeReceiver = useCallback(() => {
    receiverRef.current?.secret.fill(0);
    receiverRef.current = null;
  }, []);

  /* --------------------------------- receive -------------------------------- */

  /** Open a session and the QR for it. A previous one, if any, is dropped first. */
  const openReceive = useCallback(async (): Promise<boolean> => {
    wipeReceiver();
    setReceive(null);
    const keys = newReceiver();
    try {
      const opened = await easyRecoveryOpen(keys.publicKey, await accessKey());
      receiverRef.current = { id: opened.id, secret: keys.secret };
      setReceive({
        id: opened.id,
        link: encodeLink({ id: opened.id, key: keys.publicKey }),
        expiresAt: Date.parse(opened.expiresAt),
        status: 'open',
        ending: null,
        attemptsLeft: EASY_RECOVERY_MAX_ATTEMPTS,
      });
      return true;
    } catch (e) {
      keys.secret.fill(0);
      reportError(EVENT.apiError, e, { flow: 'easy-recovery', step: 'open' });
      setReceive({ id: '', link: '', expiresAt: 0, status: 'ended', ending: 'failed', attemptsLeft: 0 });
      return false;
    }
  }, [accessKey, wipeReceiver]);

  /** Ask where the session is. Called on an interval by the screen while it is up. */
  const pollReceive = useCallback(async () => {
    const cur = receiverRef.current;
    if (!cur) return;
    try {
      const res = await easyRecoveryStatus(cur.id, await accessKey());
      setReceive((r) => (r && r.id === cur.id && r.status === 'open' && res.status === 'offered' ? { ...r, status: 'offered' } : r));
    } catch (e) {
      if (!isGone(e)) return; // a network blip: the next poll asks again
      wipeReceiver();
      setReceive((r) => (r && r.id === cur.id ? { ...r, status: 'ended', ending: 'expired' } : r));
    }
  }, [accessKey, wipeReceiver]);

  /**
   * Send the typed code. The payload, opened, on the right one; otherwise why not — a wrong
   * code keeps the session (with one try fewer), a burned or expired one ends it.
   */
  const claimReceive = useCallback(
    async (code: string): Promise<EasyRecoveryPayload | EasyRecoveryClaimFailure> => {
      const cur = receiverRef.current;
      if (!cur) return 'ended';
      let sealed: string;
      try {
        sealed = await easyRecoveryClaim(cur.id, code, await accessKey());
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 409) return 'notYet';
        if (isGone(e)) {
          wipeReceiver();
          setReceive((r) => (r && r.id === cur.id ? { ...r, status: 'ended', ending: 'burned', attemptsLeft: 0 } : r));
          return 'ended';
        }
        if (e instanceof ApiRequestError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          let left = 0;
          setReceive((r) => {
            if (!r || r.id !== cur.id) return r;
            left = Math.max(0, r.attemptsLeft - 1);
            return left === 0 ? { ...r, attemptsLeft: 0, status: 'ended', ending: 'burned' } : { ...r, attemptsLeft: left };
          });
          return 'wrongCode';
        }
        throw e;
      }
      try {
        return await openPayload(sealed, cur.secret, cur.id);
      } finally {
        // One use: whatever was in it, this key opens nothing else.
        wipeReceiver();
        setReceive(null);
      }
    },
    [accessKey, wipeReceiver],
  );

  const closeReceive = useCallback(() => {
    wipeReceiver();
    setReceive(null);
  }, [wipeReceiver]);

  /* ---------------------------------- send ---------------------------------- */

  /**
   * Seal `payload` to the scanned device and leave it with a fresh code. The caller has
   * already had the person confirm and unlock; this only checks the session is still open,
   * so a stale or already-used QR is refused before anything leaves the device.
   */
  const offerSend = useCallback(
    async (link: EasyRecoveryLink, payload: EasyRecoveryPayload): Promise<'offered' | 'ended'> => {
      const key = await accessKey();
      try {
        const st = await easyRecoveryStatus(link.id, key);
        if (st.status !== 'open') return 'ended';
        const code = newCode();
        const ciphertext = await sealPayload(payload, link);
        await easyRecoveryOffer(link.id, { ciphertext, code }, key);
        setSend({ id: link.id, code, expiresAt: Date.parse(st.expiresAt), status: 'offered', ending: null });
        return 'offered';
      } catch (e) {
        if (isGone(e) || (e instanceof ApiRequestError && e.status === 409)) return 'ended';
        throw e;
      }
    },
    [accessKey],
  );

  /** Ask whether the other device took the wallet. */
  const pollSend = useCallback(async () => {
    const cur = send;
    if (!cur || cur.status !== 'offered') return;
    try {
      const res = await easyRecoveryStatus(cur.id, await accessKey());
      if (res.status === 'claimed') setSend((s) => (s && s.id === cur.id ? { ...s, status: 'claimed' } : s));
    } catch (e) {
      if (!isGone(e)) return;
      setSend((s) => (s && s.id === cur.id ? { ...s, status: 'ended', ending: 'expired' } : s));
    }
  }, [accessKey, send]);

  const closeSend = useCallback(() => setSend(null), []);

  return {
    easyReceive: receive,
    openEasyReceive: openReceive,
    pollEasyReceive: pollReceive,
    claimEasyReceive: claimReceive,
    closeEasyReceive: closeReceive,
    easySend: send,
    offerEasySend: offerSend,
    pollEasySend: pollSend,
    closeEasySend: closeSend,
  };
}
