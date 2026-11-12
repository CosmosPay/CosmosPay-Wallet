import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChainNet } from '@/constants/chains';
import { CHARGE_EXPIRES_MINUTES } from '@/constants/qrCharge';
import { ApiRequestError } from '@/lib/apiError';
import { cancelPaymentRequest, createPaymentRequest, getPaymentRequest } from '@/lib/cosmospay';
import type { TFn } from '@/lib/i18n';
import {
  chargeCancellable,
  chargeRequestProblem,
  chargeStorageKey,
  newCharge,
  parseStoredCharge,
  withBalance,
  withRequest,
  type PaymentRequest,
  type PaymentRequestInput,
  type QrCharge,
} from '@/lib/qrCharge';
import { storageGet, storageRemove, storageSet } from '@/lib/storage';

export interface QrChargeDeps {
  /** The active wallet; its charge is kept per wallet and mode. */
  walletId: string | null;
  chainNet: ChainNet;
  /** This account's key in the mode, or null without an account. */
  accountKey: string | null;
  /** The shared public key in the mode (awaited on a first run), or null. */
  sharedKey: () => Promise<string | null>;
  /** This wallet's own address on the EVM network with `chainId` in the mode, or null. */
  ownAddress: (chainId: number) => string | null;
  /** This wallet's balance of a token there, in base units; null when it cannot be read. */
  tokenBalance: (chainId: number, token: string, decimals: number) => Promise<bigint | null>;
  t: TFn;
}

/** What the slice keeps outside React: the scope it answers for and what it last stored there. */
interface Live {
  key: string | null;
  charge: QrCharge | null;
  saved: string;
}

/** The charge still on screen for `key`, if it is the one with `id`: an answer about anything else is dropped. */
function still(cur: Live, key: string | null, id: string): QrCharge | null {
  return cur.key === key && cur.charge?.request.id === id ? cur.charge : null;
}

/**
 * Charging with a QR in local money (`lib/qrCharge.ts`, screen `features/fiat/Charge.tsx`): the
 * one charge on screen per wallet and mode, kept in storage so a reload comes back to the same
 * QR, and the calls that make it, read it again, watch the wallet's own balance for it and cancel
 * it. The screen decides WHEN to ask (every few seconds while it is in view); every answer goes
 * through the pure rules (`withRequest`, `withBalance`), and an answer that lands after the wallet,
 * the mode or the charge changed is dropped.
 *
 * Key choice like the ramp's: the account's key, else the shared public key — and a charge made
 * with the shared key is read and cancelled only with that key and the `publicToken` the create
 * answered, kept with it.
 */
export function useQrCharge({ walletId, chainNet, accountKey, sharedKey, ownAddress, tokenBalance, t }: QrChargeDeps) {
  const storageKey = walletId ? chargeStorageKey(walletId, chainNet) : null;
  const [qrCharge, setQrCharge] = useState<QrCharge | null>(null);
  const [qrChargeLoaded, setLoaded] = useState(false);
  const live = useRef<Live>({ key: null, charge: null, saved: '' });

  useEffect(() => {
    live.current = { key: storageKey, charge: null, saved: '' };
    setQrCharge(null);
    setLoaded(false);
    if (!storageKey) {
      setLoaded(true);
      return;
    }
    let alive = true;
    storageGet(storageKey)
      .then((raw) => {
        if (!alive || !raw) return;
        let parsed: QrCharge | null = null;
        try {
          parsed = parseStoredCharge(JSON.parse(raw));
        } catch {
          parsed = null;
        }
        if (!parsed) return;
        live.current = { key: storageKey, charge: parsed, saved: JSON.stringify(parsed) };
        setQrCharge(parsed);
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [storageKey]);

  /** Keep `next` for `key` — only if that is still the scope, and only when it changed. */
  const save = useCallback((key: string | null, next: QrCharge | null) => {
    const cur = live.current;
    if (cur.key !== key) return;
    const text = next ? JSON.stringify(next) : '';
    if (text === cur.saved) return;
    cur.charge = next;
    cur.saved = text;
    setQrCharge(next);
    if (key) void (next ? storageSet(key, text) : storageRemove(key)).catch(() => {});
  }, []);

  const keyFor = useCallback(async (c: QrCharge) => (c.shared ? sharedKey() : accountKey), [accountKey, sharedKey]);

  /**
   * Make a charge and put it on screen, once the API's answer is checked to be the charge asked
   * for, paying this wallet (`chargeRequestProblem`). The wallet's balance of the token is read
   * beside it: the baseline a payment is measured from. Throws for the screen to say.
   */
  const createQrCharge = useCallback(
    async (input: Omit<PaymentRequestInput, 'expiresInMinutes'>, decimals: number): Promise<QrCharge> => {
      const key = live.current.key;
      const apiKey = accountKey ?? (await sharedKey());
      if (!apiKey) throw new Error(t('cosmospay.enableFirst'));
      const own = ownAddress(input.chainId);
      if (!own || own.toLowerCase() !== input.address.toLowerCase()) throw new Error(t('charge.addressMismatch'));
      const body: PaymentRequestInput = { ...input, expiresInMinutes: CHARGE_EXPIRES_MINUTES };
      const [req, baseline] = await Promise.all([
        createPaymentRequest(apiKey, body),
        tokenBalance(input.chainId, input.token, decimals).catch(() => null),
      ]);
      if (chargeRequestProblem(req, body)) throw new Error(t('charge.mismatch'));
      const next = newCharge(req, !accountKey, baseline);
      save(key, next);
      return next;
    },
    [accountKey, sharedKey, ownAddress, tokenBalance, save, t],
  );

  /** Ask the API about the charge on screen. A missed answer changes nothing: the next one, or the balance, tells. */
  const refreshQrCharge = useCallback(async (): Promise<void> => {
    const { key, charge } = live.current;
    if (!charge) return;
    const apiKey = await keyFor(charge);
    if (!apiKey) return;
    try {
      const req = await getPaymentRequest(apiKey, charge.request.id, charge.shared ? charge.publicToken : null);
      const cur = still(live.current, key, charge.request.id);
      if (cur) save(key, withRequest(cur, req, Date.now()));
    } catch {
      /* the next poll asks again */
    }
  }, [keyFor, save]);

  /** Read the wallet's own balance of the charge's token; the first read is the baseline. */
  const watchQrChargeBalance = useCallback(async (): Promise<void> => {
    const { key, charge } = live.current;
    if (!charge || charge.paid) return;
    const { chainId, tokenAddress, tokenDecimals, id } = charge.request;
    const balance = await tokenBalance(chainId, tokenAddress, tokenDecimals).catch(() => null);
    const cur = still(live.current, key, id);
    if (balance !== null && cur) save(key, withBalance(cur, balance, Date.now()));
  }, [tokenBalance, save]);

  /**
   * Stop the charge from being paid. One that is no longer open — here (`chargeCancellable`: a
   * transfer being credited, paid, expired) or at the API (409) — is read again instead, so the
   * screen shows what it is. Throws for the screen to say.
   */
  const cancelQrCharge = useCallback(async (): Promise<void> => {
    const { key, charge } = live.current;
    if (!charge) return;
    if (!chargeCancellable(charge, Date.now())) return refreshQrCharge();
    const apiKey = await keyFor(charge);
    if (!apiKey) throw new Error(t('charge.cancelFailed'));
    let req: PaymentRequest;
    try {
      req = await cancelPaymentRequest(apiKey, charge.request.id, charge.shared ? charge.publicToken : null);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) return refreshQrCharge();
      throw e;
    }
    const cur = still(live.current, key, charge.request.id);
    if (cur) save(key, withRequest(cur, req, Date.now()));
  }, [keyFor, refreshQrCharge, save, t]);

  /** Put the charge away (a new one is next). An open one stays payable until it expires. */
  const clearQrCharge = useCallback(() => save(live.current.key, null), [save]);

  return { qrCharge, qrChargeLoaded, createQrCharge, refreshQrCharge, watchQrChargeBalance, cancelQrCharge, clearQrCharge };
}
