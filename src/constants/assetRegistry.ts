/**
 * The asset registry the wallet ships with.
 *
 * Three sources answer "which asset is this?", in this order (see
 * `src/lib/assetRegistry.ts`):
 *
 *   1. The gateway's `/v1/assets`, which we keep updated — the newest list.
 *   2. THIS table, compiled into the build — the offline and first-run answer.
 *   3. The user's own Horizon, for anything neither of the above names.
 *
 * It exists because the wallet must be able to name an asset before it can reach
 * a network. A fresh install on a plane, an MV3 popup opening while the gateway
 * is down, a custom network pointed at somebody's private Horizon: in all three
 * the token picker still has to say whether the `USDC` in front of the user is
 * Circle's. Shipping the answer is the only way to guarantee that.
 *
 * On Stellar an asset is a (code, issuer) PAIR. The code alone is not an
 * identifier and never was — mainnet currently carries twenty-odd issuers of
 * `USDC` and eight of `USDT0` — so nothing here is keyed on a bare code, and the
 * two `EURC` rows below are both legitimate and both kept.
 *
 * `version` is what lets the fetched list and this one be compared. The canonical
 * copy lives in the Payments service, whose own `assets:verify` script checks every
 * row against live Horizon; when you bump one, bump both.
 */

/** Issuer powers a holder cannot undo once the trustline exists. */
export interface IssuerFlags {
  /** The issuer may freeze this trustline. */
  authRevocable: boolean;
  /** The issuer may claw the balance back out of the holder's account. */
  clawback: boolean;
}

export interface RegistryAsset {
  code: string;
  /** null for the native asset. */
  issuer: string | null;
  name: string;
  /**
   * Who issues it, in the user's words — `Circle`, `Tether`.
   *
   * Rendered next to the code everywhere an asset is chosen or trusted. On
   * testnet it is the ONLY distinguishing information: no testnet issuer
   * publishes a home domain, so `USDC · Circle` versus a bare `USDC` is the
   * whole difference between a user who can tell and one who cannot.
   */
  issuerName: string;
  /**
   * The issuer's on-chain `home_domain`, or empty when it publishes none —
   * USDT0 and every testnet issuer. Never a domain attributed by a third party:
   * shown beside a token, that reads as the issuer's own claim.
   */
  issuerDomain: string;
  /**
   * Whether the issuing account was checked against the organization named in
   * `issuerName`.
   *
   * A claim about IDENTITY, not about quality or safety. An unverified entry is
   * shown, not hidden — hiding it would push the user to the manual issuer field,
   * where they have less information, not more — but it must never be rendered
   * the same way a verified one is.
   */
  verified: boolean;
  flags: IssuerFlags;
}

const NATIVE: RegistryAsset = {
  code: 'XLM',
  issuer: null,
  name: 'Stellar Lumens',
  issuerName: 'Stellar network',
  issuerDomain: 'stellar.org',
  verified: true,
  flags: { authRevocable: false, clawback: false },
};

/** Mainnet. Trustline counts as of verification are in the comments. */
const PUBLIC_ASSETS: RegistryAsset[] = [
  NATIVE,
  {
    // 2,390,585 trustlines, home_domain circle.com.
    code: 'USDC',
    issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    name: 'USD Coin',
    issuerName: 'Circle',
    issuerDomain: 'circle.com',
    verified: true,
    flags: { authRevocable: true, clawback: false },
  },
  {
    // Tether's omnichain USDT0. 12,212 trustlines and 12 pools; the eight other
    // accounts issuing this code on mainnet do not reach 300 between the largest
    // of them. The issuing account publishes no home_domain, so `issuerDomain` is
    // empty on purpose — its identity rests on the SAC id and the trustline count,
    // and printing an explorer's attribution would be showing the user a claim the
    // ledger does not make. Both flags set: Tether can freeze and claw back.
    code: 'USDT0',
    issuer: 'GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q',
    name: 'USDT0',
    issuerName: 'Tether',
    issuerDomain: '',
    verified: true,
    flags: { authRevocable: true, clawback: true },
  },
  {
    // 34,568 trustlines, home_domain circle.com.
    code: 'EURC',
    issuer: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
    name: 'Euro Coin',
    issuerName: 'Circle',
    issuerDomain: 'circle.com',
    verified: true,
    flags: { authRevocable: true, clawback: false },
  },
  {
    // A SECOND legitimate EURC (MyKobo, 12,806 trustlines, home_domain
    // mykobo.co). Not a clone of the row above — a different euro token that
    // shares the code. Keeping both is the point: it is what forces every screen
    // to render the issuer, and what would break a screen that keyed on the code.
    code: 'EURC',
    issuer: 'GAQRF3UGHBT6JYQZ7YSUYCIYWAF4T2SAA5237Q5LIQYJOHHFAWDXZ7NM',
    name: 'Euro Coin',
    issuerName: 'MyKobo',
    issuerDomain: 'mykobo.co',
    verified: true,
    flags: { authRevocable: false, clawback: false },
  },
  {
    // 191,956 trustlines, 1,308 pools, home_domain aqua.network.
    code: 'AQUA',
    issuer: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA',
    name: 'Aquarius',
    issuerName: 'Aquarius',
    issuerDomain: 'aqua.network',
    verified: true,
    flags: { authRevocable: false, clawback: false },
  },
  {
    // 53,878 trustlines, home_domain ultracapital.xyz.
    code: 'yXLM',
    issuer: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55',
    name: 'Ultra Stellar XLM',
    issuerName: 'Ultra Capital',
    issuerDomain: 'ultracapital.xyz',
    verified: true,
    flags: { authRevocable: false, clawback: false },
  },
  {
    // 328,632 trustlines, home_domain pubnet-sep.latamex.com.
    code: 'ARST',
    issuer: 'GCSAZVWXZKWS4XS223M5F54H2B6XPIIXZZGP7KEAIU6YSL5HDRGCI3DG',
    name: 'Argentine Peso',
    issuerName: 'Latamex',
    issuerDomain: 'pubnet-sep.latamex.com',
    verified: true,
    flags: { authRevocable: false, clawback: false },
  },
  {
    // 6,983 trustlines, home_domain ntokens.com. Listed but NOT verified: the
    // issuer holds both freeze and clawback and the domain carries no reputation
    // we could check. The user still gets to choose — with the warning shown.
    code: 'BRL',
    issuer: 'GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP',
    name: 'Brazilian Real',
    issuerName: 'NTokens',
    issuerDomain: 'ntokens.com',
    verified: false,
    flags: { authRevocable: true, clawback: true },
  },
];

/**
 * Testnet, where the registry matters most.
 *
 * NO testnet issuer publishes a home domain, so every candidate is an anonymous
 * `G…` account and an explorer shows nothing that separates them. Thirteen
 * accounts issue `USDT0` here and none of them is Tether — which is why the
 * testnet list contains only assets this platform actually integrates against,
 * and why a testnet asset outside it is left to the unverified path rather than
 * guessed at.
 */
const TESTNET_ASSETS: RegistryAsset[] = [
  NATIVE,
  {
    // 64,325 trustlines, home_domain centre.io — Circle's faucet asset.
    code: 'USDC',
    issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    name: 'USD Coin',
    issuerName: 'Circle',
    issuerDomain: 'centre.io',
    verified: true,
    flags: { authRevocable: true, clawback: false },
  },
  {
    // BlindPay's test stablecoin — what this wallet's own fiat rails settle in.
    // Verified because the integration is ours, which is a stronger claim than a
    // DNS record rather than a weaker one.
    code: 'USDB',
    issuer: 'GCQSSIMOW5OCGULZATDXKU5MOJBOMFX6G65X6CXZDQ7AIB3SKFUZ67NX',
    name: 'USD BlindPay',
    issuerName: 'BlindPay',
    issuerDomain: '',
    verified: true,
    flags: { authRevocable: true, clawback: false },
  },
];

/** Keyed by `NetConfig.id`; unknown networks get no bundled entries. */
export const BUNDLED_ASSETS: Record<string, RegistryAsset[]> = {
  public: PUBLIC_ASSETS,
  testnet: TESTNET_ASSETS,
};

/** Bump alongside the Payments service's `ASSET_REGISTRY_VERSION`. */
export const BUNDLED_ASSETS_VERSION = 1;

/**
 * How long a fetched registry is reused before asking again.
 *
 * An hour, because the list changes a handful of times a year while every screen
 * that shows a token would otherwise ask for it. The cached copy is also what a
 * subsequent offline launch reads, so this is the freshness bound, not the
 * lifetime.
 */
export const ASSET_REGISTRY_TTL_MS = 60 * 60 * 1000;

/** Storage key for the last registry fetched, per network. */
export const ASSET_REGISTRY_KEY = 'cosmos.assets';
