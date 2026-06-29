/**
 * Non-custodial key management for Stellar.
 *
 * Keys are derived locally and never leave the device. We follow SEP-0005
 * (BIP-39 mnemonic -> seed -> SLIP-0010 ed25519 derivation on m/44'/148'/n').
 * This is the same scheme used by Lobstr, Solar, Freighter, etc., so a phrase
 * created here can be restored in any SEP-5 compatible wallet and vice-versa.
 */
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

export interface DerivedAccount {
  publicKey: string; // G...
  secret: string; // S...
}

/** Stellar's SEP-5 derivation path for account `index`. */
const path = (index: number) => `m/44'/148'/${index}'`;

/** Generate a fresh 12-word (128-bit) BIP-39 recovery phrase. */
export function createMnemonic(): string {
  return generateMnemonic(128);
}

export function isValidMnemonic(phrase: string): boolean {
  return validateMnemonic(normalizeMnemonic(phrase));
}

/** Collapse whitespace + lowercase so pasted phrases validate reliably. */
export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Derive the Stellar keypair for a given account index from a mnemonic. */
export async function accountFromMnemonic(
  phrase: string,
  index = 0,
): Promise<DerivedAccount> {
  const mnemonic = normalizeMnemonic(phrase);
  if (!validateMnemonic(mnemonic)) {
    throw new Error('La frase de recuperación no es válida.');
  }
  const seed = await mnemonicToSeed(mnemonic);
  const { key } = derivePath(path(index), seed.toString('hex'));
  const keypair = Keypair.fromRawEd25519Seed(Buffer.from(key));
  return { publicKey: keypair.publicKey(), secret: keypair.secret() };
}

/** Import directly from a raw secret key (S...). No mnemonic available. */
export function accountFromSecret(secret: string): DerivedAccount {
  const s = secret.trim();
  if (!StrKey.isValidEd25519SecretSeed(s)) {
    throw new Error('La clave secreta no es válida (debe empezar por «S»).');
  }
  const keypair = Keypair.fromSecret(s);
  return { publicKey: keypair.publicKey(), secret: keypair.secret() };
}

export function isValidSecret(secret: string): boolean {
  return StrKey.isValidEd25519SecretSeed(secret.trim());
}

export function isValidPublicKey(pub: string): boolean {
  return StrKey.isValidEd25519PublicKey(pub.trim());
}

/**
 * Accept whatever the user pasted into the "import" box and figure out what it is.
 * Returns the derived account plus the mnemonic (when one is available, so it can
 * be re-sealed for backup/export).
 */
export async function importAccount(
  input: string,
): Promise<{ account: DerivedAccount; mnemonic: string | null }> {
  const value = input.trim();
  if (!value) throw new Error('Introduce tu frase de recuperación o clave secreta.');

  // A single 56-char S... token => secret key import.
  if (!/\s/.test(value) && isValidSecret(value)) {
    return { account: accountFromSecret(value), mnemonic: null };
  }

  // Otherwise treat it as a recovery phrase.
  const mnemonic = normalizeMnemonic(value);
  const account = await accountFromMnemonic(mnemonic);
  return { account, mnemonic };
}
