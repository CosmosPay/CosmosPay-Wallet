/**
 * The wallets "Desde otra wallet" walks through (src/features/onboarding/ImportWallet.tsx).
 * Data only: each one's name, its logo under `public/`, and what it hands out — the screen
 * picks the step-by-step copy (`importWallet.<id>.s1/.s2`) and the paste line from these.
 *
 * The logos are the wallets' own app icons, used only to point at the wallet the person
 * already has. Names are proper nouns and stay untranslated; "other" is the generic guide.
 */
export type ImportWalletId = 'freighter' | 'lobstr' | 'xbull' | 'trust' | 'rabet' | 'other';

/** What that wallet shows the person: its recovery phrase, its secret key, or either one. */
export type ImportWalletSecret = 'phrase' | 'key' | 'either';

export interface ImportWallet {
  id: ImportWalletId;
  name: string;
  /** Path under `public/`, without the base URL. Null: the generic guide draws an icon. */
  logo: string | null;
  secret: ImportWalletSecret;
}

export const IMPORT_WALLETS: readonly ImportWallet[] = [
  { id: 'freighter', name: 'Freighter', logo: 'brand/wallets/freighter.png', secret: 'phrase' },
  { id: 'lobstr', name: 'LOBSTR', logo: 'brand/wallets/lobstr.png', secret: 'key' },
  { id: 'xbull', name: 'xBull', logo: 'brand/wallets/xbull.png', secret: 'either' },
  { id: 'trust', name: 'Trust Wallet', logo: 'brand/wallets/trust.png', secret: 'phrase' },
  { id: 'rabet', name: 'Rabet', logo: 'brand/wallets/rabet.png', secret: 'key' },
  { id: 'other', name: '', logo: null, secret: 'either' },
];
