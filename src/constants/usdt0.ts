/**
 * USDT0 on Stellar and the contracts its bridge out of Stellar goes through (`lib/usdt0.ts`,
 * the `usdt0` intent in `lib/txGuard.ts`). Mainnet only: USDT0 does not exist on testnet.
 *
 * Every id here is one the signing guard compares an envelope against, so a change in this
 * file widens or narrows what the wallet will sign — read it as a security diff. Each was read
 * from the ledger, not from a server's answer: the OFT and the token from the community server's
 * pinned constants and the deployed contracts' own `oft()` / `token()`, the fee collector and the
 * XLM contract from a mainnet simulation of `send` (2026-11-09), the wrapper from its deployment.
 */

/** The classic asset: Tether's USDT0 issuer on Stellar mainnet. */
export const USDT0_STELLAR = { code: 'USDT0', issuer: 'GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q' } as const;

/** USDT0's Stellar Asset Contract: what `send` burns from the holder. */
export const USDT0_SAC = 'CBSJZEIO5C7KC2SF3MKSNXXJSW5G3VTNBX4ATMKUI3B2MR4JKM4R26YF';

/** The OFT whose `send(from, send_param, fee, refund_address)` moves USDT0 out of Stellar. */
export const USDT0_OFT = 'CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6';

/** XLM's Stellar Asset Contract on mainnet: the bridge's fee is paid in XLM through it. */
export const XLM_SAC_MAINNET = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';

/**
 * Where `send` pays the bridge's XLM fee: the messaging endpoint the OFT is bound to. The fee
 * may go nowhere else; the part it does not charge comes back to `refund_address` in the same
 * transaction.
 */
export const USDT0_FEE_COLLECTOR = 'CCQLLRE5JBAWYCW3KTWOIWLMFDUOKROQVZNSALQMGOSXNW3ERUOWTZGK';

/**
 * Cosmos Pay's fee wrappers (`contracts/soroban/usdt0-fee-wrapper` in the community server): a
 * contract that pays the plan's commission in USDT0, then calls the OFT's `send` with the same
 * arguments, under the holder's one authorization. The gateway builds a transfer through it when
 * it charges a commission. A new deployment is a new id here, and until then the wallet refuses
 * transfers through it.
 */
export const USDT0_FEE_WRAPPERS: readonly string[] = ['CDAYCXRZED6MDKETBJSSFLF66LDHXZFTRXTIZXVYEIIM76MTFPH5STC3'];

/** At most this many fee payments ride on a wrapper call: the plan's commission. */
export const USDT0_MAX_FEE_LEGS = 1;

/** How long the routes list (`GET /v1/usdt0/routes`) is kept before it is asked again. */
export const USDT0_ROUTES_TTL_MS = 10 * 60_000;

/**
 * The `contract` a swap-catalog token carries when the wallet knows it only as a destination of
 * the bridge (a network where nothing else lists its USDT / USDT0). Not null, because null is a
 * network's coin everywhere in the catalogue, and a balance read for it would show the coin's.
 */
export const USDT0_BRIDGE_TOKEN = 'usdt0-bridge';
