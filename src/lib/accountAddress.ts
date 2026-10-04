/**
 * Which Stellar address a wallet acts as, on a given network.
 *
 * Almost always its `publicKey`, on every network. The exception is a wallet that came
 * back through SEP-30 recovery (`recoverWallet` in the store): its `publicKey` is the
 * recovered ACCOUNT, and the new key signs for that account as one of its signers — but
 * only on the ONE ledger where the re-key transaction landed. Testnet and mainnet are
 * separate ledgers that happen to share an address space, so on every other network the
 * old account is still controlled by the lost key alone, and acting as it there would
 * build payments the new key cannot sign: each one fails at submit.
 *
 * So a re-keyed wallet carries a `Rekey`: the ledger it was re-keyed on, and the new
 * key's own address. On that ledger it is the account, with its history and balances; on
 * every other one it is the key's own address — a fresh account the key fully controls.
 * Both networks work, and neither pretends to be the other.
 */
import { Keypair } from '@stellar/stellar-sdk';

/** The ledger an account was re-keyed on, and the address of the key that replaced it. */
export interface Rekey {
  /** Network passphrase of the ledger the re-key landed on. */
  passphrase: string;
  /** The new key's own G… address. */
  keyAddress: string;
}

/** The address `entry` acts as on the network whose passphrase is `passphrase`. */
export function addressOn(entry: { publicKey: string; rekey?: Rekey }, passphrase: string): string {
  return entry.rekey && entry.rekey.passphrase !== passphrase ? entry.rekey.keyAddress : entry.publicKey;
}

/**
 * The `Rekey` a restored box implies: none when the key IS the account, and none when
 * the box predates this record (`passphrase` absent) — guessing a ledger would point a
 * wallet at an account the key may not sign for anywhere.
 */
export function rekeyOf(account: string, keyAddress: string, passphrase: string | undefined): Rekey | undefined {
  if (account === keyAddress || !passphrase) return undefined;
  return { passphrase, keyAddress };
}

/** The G… address a Stellar secret signs as. */
export function keyAddressOf(secret: string): string {
  return Keypair.fromSecret(secret).publicKey();
}

/**
 * For a wallet recovered before re-keys were recorded: the ledger on which `keyAddress`
 * can sign for the account, read from each network's live signer list (null when a
 * network could not be read). Exactly one, or nothing — a key listed on two ledgers, or
 * on none, is not a case to guess about.
 */
export function ledgerOfRekey(keyAddress: string, ledgers: { passphrase: string; signers: string[] | null }[]): string | undefined {
  const found = ledgers.filter((l) => l.signers?.includes(keyAddress));
  return found.length === 1 ? found[0].passphrase : undefined;
}

/** `rekeyOf` for what `openBackup` returned. */
export function rekeyOfBackup(opened: { secret: string; account?: string; rekeyedOn?: string }): Rekey | undefined {
  if (!opened.account) return undefined;
  return rekeyOf(opened.account, Keypair.fromSecret(opened.secret).publicKey(), opened.rekeyedOn);
}
