/**
 * WalletConnect v2, the wallet side (`src/lib/walletConnect.ts`, `src/lib/walletConnectClient.ts`,
 * `src/state/useWalletConnect.ts`): how a website that is not in this browser — the P2P
 * marketplace's window above all — reaches the 0x account from the web wallet, the desktop and
 * mobile apps and the extension alike. The site shows a QR (a `wc:` pairing URI); the wallet
 * scans or pastes it, approves a session, and answers its requests through the relay.
 */

/**
 * Cosmos's own project on dashboard.walletconnect.com (a "Wallet" project), compiled in like the
 * gateway's default URL: every build — CI, a laptop, the stores — connects with it unless
 * `PUBLIC_WALLETCONNECT_PROJECT_ID` names another (a self-hosted build's own) or `off`. Not a
 * secret: it ships in every client, and the dashboard's domain allowlist is what confines it.
 */
export const WC_DEFAULT_PROJECT_ID = 'a4a9322c6efd4b491c0b194fe68d0e65';

/** The CAIP-2 namespace of every chain the wallet offers: EVM only. */
export const WC_NAMESPACE = 'eip155';

/**
 * The methods a session may carry. `eth_signTypedData` (no version) is read as v4, the shape
 * every current site sends under it; `wallet_switchEthereumChain` is answered for a chain the
 * session already holds. Everything else a site asks is refused as unsupported.
 */
export const WC_METHODS = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'eth_signTypedData', 'wallet_switchEthereumChain'] as const;
export type WcMethod = (typeof WC_METHODS)[number];

/** The methods that sign: each opens the approval (the rest are answered without one). */
export const WC_SIGN_METHODS: readonly WcMethod[] = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'eth_signTypedData'];

export const WC_EVENTS = ['chainChanged', 'accountsChanged'] as const;

/**
 * What the wallet tells a site about itself. The icon is the deployed web wallet's, the only
 * address every build can point a site at.
 */
export const WC_METADATA = {
  name: 'Cosmos Wallet',
  description: 'Cosmos Wallet — a non-custodial multi-network wallet by Cosmos Pay.',
  url: 'https://cosmospay.lat/wallet/',
  icons: ['https://cosmospay.lat/wallet/logo-512.png'],
} as const;

/**
 * The hosts the SDK talks to: the relay (a WebSocket) and the Verify API. Every build's
 * connect-src lists them (`scripts/build-extension.ts`, `src-tauri/tauri.conf.json`); the web
 * build sends no CSP. `tests/unit/walletConnect.test.ts` keeps those lists in step with this one.
 */
export const WC_RELAY_ORIGINS: readonly string[] = ['wss://relay.walletconnect.org', 'wss://relay.walletconnect.com'];
export const WC_VERIFY_ORIGINS: readonly string[] = ['https://verify.walletconnect.org', 'https://verify.walletconnect.com'];

/** A pairing URI is a few hundred characters; anything far longer is not one. */
export const WC_URI_MAX_CHARS = 2048;

/** Proposals and requests waiting for an answer, at most; past it the oldest is refused. */
export const WC_QUEUE_MAX = 20;

/**
 * Where the wallet records which wallet and mode each session was approved for (`lib/storage.ts`),
 * so the settings can say it and a request can be refused after a switch. WalletKit keeps the
 * sessions themselves (IndexedDB, its own prefix).
 */
export const WC_BINDINGS_KEY = 'cosmos.wc.bindings';
