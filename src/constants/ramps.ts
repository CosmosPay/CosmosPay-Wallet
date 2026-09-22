/**
 * Wallet-facing catalogue of money-movement providers.
 *
 * A provider is deliberately data, rather than a condition scattered through the
 * fiat screens.  When a new anchor is connected, add its descriptor and adapter
 * without changing the entry point or the user's mental model of the flow.
 */
export type RampProvider = {
  id: string;
  name: string;
  anchor: string;
  rails: readonly string[];
  tokens: readonly string[];
  status: 'active' | 'coming-soon';
};

export const RAMP_PROVIDERS: readonly RampProvider[] = [
  {
    id: 'blindpay',
    name: 'BlindPay',
    anchor: 'Stellar',
    rails: ['PIX', 'SPEI', 'PSE', 'ACH'],
    tokens: ['USDC', 'USDT'],
    status: 'active',
  },
];

export const DEFAULT_RAMP_PROVIDER = RAMP_PROVIDERS[0];
