/**
 * The inputs a flow keeps while the person walks back and forth through it
 * (`src/lib/keptInputs.ts`), one key each. Only what was typed or chosen and is not a
 * secret: never a password, a recovery phrase, a secret key or a one-time code.
 */
export const KEPT_INPUT = {
  /** BackupChoice: the account or the twelve words. */
  backupChoice: 'backup-choice.choice',
  /** Backup: "I saved my phrase" — for THIS phrase; a new one clears it (`startCreate`). */
  backupSaved: 'backup.saved',
  /** Backup: the Terms. */
  backupTerms: 'backup.terms',
  /** The sign-in's email step. */
  signInEmail: 'sign-in.email',
  /** RecoverAccount: which of the inbox's wallets to recover. */
  recoverAccount: 'recover-account.address',
  /** SignInPassword: turn this device to a passkey on the restore. */
  restorePasskey: 'sign-in-password.passkey',
  /** Home: the tab under the actions, and the holdings' network filter. */
  homeTab: 'home.tab',
  homeNetwork: 'home.network',
} as const;
