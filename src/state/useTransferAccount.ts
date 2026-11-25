import { useCallback, useRef } from 'react';
import { createTransferAccount, getTransferAccount } from '@/lib/cosmospay';
import type { TFn } from '@/lib/i18n';
import {
  readTransferAccount,
  transferAccountBody,
  transferAccountReadError,
  type TransferAccount,
  type TransferAccountDraft,
  type TransferAccountRead,
} from '@/lib/transferAccount';

export interface TransferAccountDeps {
  /** This account's key in the mode, or null without an account. */
  accountKey: string | null;
  /** The shared public key in the mode (awaited on a first run), or null. */
  sharedKey: () => Promise<string | null>;
  t: TFn;
}

/**
 * The seller's bank transfer account (`lib/transferAccount.ts`, card
 * `features/fiat/TransferAccountCard.tsx`): the two calls, each with the right key. The card
 * keeps what they answer; nothing here is stored, because the API's answer is the account.
 *
 * Only an account has one. Without an account key the read is a probe with the shared public
 * key: `403 account_required` means this deployment offers bank transfers to accounts, so the
 * card asks the seller to sign in; anything else, and the card stays away.
 *
 * The account keys read successfully in this session are remembered (memory only): an
 * unexplained failure reads as "off" unless the rail was seen working for this key, so a server
 * without bank transfers that answers a 500 never gets a "Bank transfers" card with a retry.
 */
export function useTransferAccount({ accountKey, sharedKey, t }: TransferAccountDeps) {
  const readOk = useRef(new Set<string>());

  /** Whether this account's transfer account was read in this session: the rail is there. */
  const transferAccountSeen = useCallback(() => !!accountKey && readOk.current.has(accountKey), [accountKey]);

  const loadTransferAccount = useCallback(async (): Promise<TransferAccountRead> => {
    if (!accountKey) {
      const shared = await sharedKey().catch(() => null);
      if (!shared) return { kind: 'off' };
      try {
        await getTransferAccount(shared);
        return { kind: 'signin' };
      } catch (e) {
        return transferAccountReadError(e, true);
      }
    }
    try {
      const account = readTransferAccount(await getTransferAccount(accountKey));
      readOk.current.add(accountKey);
      return { kind: 'account', account };
    } catch (e) {
      return transferAccountReadError(e, false, readOk.current.has(accountKey));
    }
  }, [accountKey, sharedKey]);

  /**
   * Activate the account with the form's details (or try again after a rejection). The form's
   * own rules are checked again here (`transferAccountBody`): a disabled button is a hint.
   * Throws for the card to say.
   */
  const activateTransferAccount = useCallback(
    async (draft: TransferAccountDraft): Promise<TransferAccount> => {
      if (!accountKey) throw new Error(t('transfer.signIn'));
      const body = transferAccountBody(draft, Date.now());
      if (!body) throw new Error(t('transfer.formIncomplete'));
      return readTransferAccount(await createTransferAccount(accountKey, body));
    },
    [accountKey, t],
  );

  return { loadTransferAccount, activateTransferAccount, transferAccountSeen };
}
