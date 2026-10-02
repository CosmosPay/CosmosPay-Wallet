/**
 * The backends a build talks to when nothing in `.env` names one.
 *
 * These are FALLBACKS, not configuration. `.env` and `.env.example` are the place to
 * decide where a build points: `PUBLIC_COSMOS_GATEWAY_URL`, `PUBLIC_COSMOS_GATEWAY_ENTRY`
 * and the two recovery URLs win wherever they are set. What lives here is the answer for a build that shipped none of them — which was
 * every extension and Tauri release until the workflows started passing them through,
 * and is still any fork that clones without an `.env`.
 *
 * It is its own module rather than three literals inside `lib/endpoints.ts` because
 * `scripts/build-extension.ts` has to reach the same answer. The MV3 manifest's
 * `host_permissions` are what exempt the popup from CORS, so a host the wallet calls
 * and the manifest does not name is a host the extension cannot reach at all. Two
 * copies of that list is two chances to ship an extension that cannot talk to its own
 * backend — and from inside the popup that failure is indistinguishable from the
 * server being down.
 */

/**
 * APISIX gateway: the payments API, the wallet's sign-in and the public key — everything
 * the wallet calls. The developer platform is deliberately not a backend of the wallet:
 * it issues developers' keys and shows data, and nothing here may depend on it being up.
 */
export const DEFAULT_GATEWAY_URL = 'https://api.cosmospay.lat';

/** Gateway entry prefix. APISIX strips it itself before forwarding upstream. */
export const DEFAULT_GATEWAY_ENTRY = '/cosmos-api';

/**
 * The two SEP-30 recovery servers (`src/lib/recovery.ts`).
 *
 * TWO deployments, deliberately separate: each holds one of the two signers an account is
 * recovered with, and neither weighs enough alone. Pointing both at the same host — or
 * leaving one at its default while the other moves — collapses that into one server with
 * two names, which is the single thing this design is built to avoid. A build that changes
 * one must change the other.
 */
export const DEFAULT_RECOVERY_A_URL = 'https://recovery-a.cosmospay.lat';
export const DEFAULT_RECOVERY_B_URL = 'https://recovery-b.cosmospay.lat';

/**
 * The Solana and Monad nodes the swap screen reads balances from, simulates with and
 * broadcasts through when a swap is paid from one of those chains. Public mainnet
 * endpoints: both answer CORS, and both are rate-limited, which is fine for one wallet
 * and is why a build expecting traffic should point `PUBLIC_SOLANA_RPC_URL` /
 * `PUBLIC_MONAD_RPC_URL` at a node of its own.
 */
export const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
export const DEFAULT_MONAD_RPC_URL = 'https://rpc.monad.xyz';

/**
 * Their test networks: Solana devnet and Monad testnet. The wallet reads the native
 * balance there and asks devnet for an airdrop whenever Stellar is on a test network, so a
 * developer holds test SOL / MON beside test XLM. Public and rate-limited, like the two
 * above; `PUBLIC_SOLANA_TESTNET_RPC_URL` / `PUBLIC_MONAD_TESTNET_RPC_URL` replace them.
 */
export const DEFAULT_SOLANA_TESTNET_RPC_URL = 'https://api.devnet.solana.com';
export const DEFAULT_MONAD_TESTNET_RPC_URL = 'https://testnet-rpc.monad.xyz';
