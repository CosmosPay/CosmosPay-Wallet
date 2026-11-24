/**
 * The services Cosmos Pay is built on. Copy a person reads never names them (the product
 * owner's rule): it says what happens instead (a swap across networks, Solana's market, a
 * verified fiat account). Only the terms of service and the privacy text may name them, where
 * the law asks for it. Code, comments and identifiers keep the real names.
 *
 * `tests/unit/providerNames.test.ts` checks every i18n value and the bundled asset tables
 * against this list, and `lib/assetRegistry.ts` drops a name from the server's registry that
 * matches one (`namesProvider` in `lib/providerNames.ts`).
 */
export const PROVIDER_NAMES = [
  'NEAR Intents',
  '1Click',
  'LayerZero',
  'Jupiter',
  'Kuru',
  'OpenZeppelin',
  'BlindPay',
  'Trustless Work',
  'El Dorado',
] as const;
