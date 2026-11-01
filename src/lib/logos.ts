/**
 * Every network and asset is drawn with its own official artwork, never another's: Base, Arbitrum
 * and OP are not "ETH", and a token is not a letter. The files are the developer platform's
 * (`src/assets/logos` and `public/media/brands` in CosmosPay-Developer-Platform, generated there by
 * its fetch-token-logos script), copied as they are to `public/logos/`; sources and licences in
 * the `SOURCES.md` of each folder under `public/logos/`. Refresh them there and copy them again — do not edit by hand.
 * A symbol missing here has no artwork we could vouch for, and the UI shows its glyph instead.
 */
import { NETWORK_IDS, NETWORKS, type NetworkId } from '@/constants/networks';

/** Keyed by normalized symbol (`normalizeSymbol`): one symbol on several networks shares one logo. */
export const TOKEN_LOGOS: Record<string, string> = {
  AAVE: 'tokens/aave.webp',
  ABG: 'tokens/abg.webp',
  ADA: 'tokens/ada.webp',
  ADI: 'tokens/adi.webp',
  ALEO: 'tokens/aleo.webp',
  APT: 'tokens/apt.webp',
  ARB: 'tokens/arb.webp',
  ASTER: 'tokens/aster.webp',
  AURORA: 'tokens/aurora.webp',
  AVAX: 'tokens/avax.webp',
  BCH: 'tokens/bch.webp',
  BERA: 'tokens/bera.webp',
  BLACKDRAGON: 'tokens/blackdragon.webp',
  BNB: 'tokens/bnb.webp',
  BOME: 'tokens/bome.webp',
  BRETT: 'tokens/brett.webp',
  BTC: 'tokens/btc.webp',
  CASHCAT: 'tokens/cashcat.webp',
  CBBTC: 'tokens/cbbtc.webp',
  CFI: 'tokens/cfi.webp',
  COCA: 'tokens/coca.webp',
  COW: 'tokens/cow.webp',
  DAI: 'tokens/dai.webp',
  DASH: 'tokens/dash.webp',
  DOGE: 'tokens/doge.webp',
  ETH: 'tokens/eth.webp',
  EURC: 'brands/eurc.webp',
  EURE: 'tokens/eure.webp',
  EVAA: 'tokens/evaa.webp',
  FOGO: 'tokens/fogo.webp',
  FRAX: 'tokens/frax.webp',
  GBPE: 'tokens/gbpe.webp',
  GMX: 'tokens/gmx.webp',
  GNEAR: 'tokens/gnear.webp',
  GNO: 'tokens/gno.webp',
  GRAM: 'tokens/gram.webp',
  HAPI: 'tokens/hapi.webp',
  HEMIBTC: 'tokens/hemibtc.webp',
  HYPE: 'networks/hypercore.webp',
  JAMBO: 'tokens/jambo.webp',
  KAITO: 'tokens/kaito.webp',
  KNC: 'tokens/knc.webp',
  'KV-GTSOLB': 'tokens/kv-gtsolb.webp',
  LINK: 'tokens/link.webp',
  LOUD: 'tokens/loud.webp',
  LTC: 'tokens/ltc.webp',
  MELANIA: 'tokens/melania.webp',
  MOG: 'tokens/mog.webp',
  MON: 'brands/monad.webp',
  MOVE: 'tokens/move.webp',
  MPDAO: 'tokens/mpdao.webp',
  NEAR: 'tokens/near.webp',
  NEARKAT: 'tokens/nearkat.webp',
  NOEAR: 'tokens/noear.webp',
  NPRO: 'tokens/npro.webp',
  NRUSDT: 'tokens/nrusdt.webp',
  OKB: 'tokens/okb.webp',
  OP: 'tokens/op.webp',
  PENGU: 'tokens/pengu.webp',
  PEPE: 'tokens/pepe.webp',
  POL: 'tokens/pol.webp',
  PUBLIC: 'tokens/public.webp',
  PURGE: 'tokens/purge.webp',
  QTC: 'tokens/qtc.webp',
  RHEA: 'tokens/rhea.webp',
  SAFE: 'tokens/safe.webp',
  SHIB: 'tokens/shib.webp',
  SHITZU: 'tokens/shitzu.webp',
  SOL: 'brands/sol.svg',
  SPX: 'tokens/spx.webp',
  STNEAR: 'tokens/stnear.webp',
  STRK: 'tokens/strk.webp',
  SUI: 'tokens/sui.webp',
  SUSDC: 'tokens/susdc.webp',
  SWEAT: 'tokens/sweat.webp',
  TITN: 'tokens/titn.webp',
  TON: 'networks/ton.webp',
  TRUMP: 'tokens/trump.webp',
  TRX: 'tokens/trx.webp',
  TURBO: 'tokens/turbo.webp',
  UNI: 'tokens/uni.webp',
  USAD: 'tokens/usad.webp',
  USD1: 'tokens/usd1.webp',
  USDC: 'brands/usdc.svg',
  USDE: 'tokens/usde.webp',
  USDF: 'tokens/usdf.webp',
  USDG: 'tokens/usdg.webp',
  USDT: 'tokens/usdt.webp',
  USDT0: 'tokens/usdt0.webp',
  VVV: 'tokens/vvv.webp',
  WBTC: 'tokens/wbtc.webp',
  WETH: 'tokens/weth.webp',
  WIF: 'tokens/wif.webp',
  WNEAR: 'tokens/near.webp',
  WNEARKAT: 'tokens/wnearkat.webp',
  WSTETH: 'tokens/wsteth.webp',
  XAUT: 'tokens/xaut.webp',
  XBTC: 'tokens/xbtc.webp',
  XDAI: 'tokens/xdai.webp',
  XLM: 'brands/xlm.svg',
  XPL: 'tokens/xpl.webp',
  XRP: 'tokens/xrp.webp',
  ZEC: 'tokens/zec.webp',
};

/** Every network the wallet knows has its own mark — a new one does not compile without it. */
export const NETWORK_LOGOS: Record<NetworkId, string> = {
  stellar: 'brands/xlm.svg',
  solana: 'brands/sol.svg',
  monad: 'brands/monad.webp',
  eth: 'networks/eth.webp',
  base: 'networks/base.webp',
  arb: 'networks/arb.webp',
  op: 'networks/op.webp',
  bsc: 'networks/bsc.webp',
  pol: 'networks/pol.webp',
  avax: 'networks/avax.webp',
  gnosis: 'networks/gnosis.webp',
  bera: 'networks/bera.webp',
  scroll: 'networks/scroll.webp',
  xlayer: 'networks/xlayer.webp',
  abs: 'networks/abs.webp',
  plasma: 'networks/plasma.webp',
  hood: 'networks/hood.webp',
  hypercore: 'networks/hypercore.webp',
  btc: 'networks/btc.webp',
  ltc: 'networks/ltc.webp',
  doge: 'networks/doge.webp',
  bch: 'networks/bch.webp',
  dash: 'networks/dash.webp',
  zec: 'networks/zec.webp',
  xrp: 'networks/xrp.webp',
  tron: 'networks/tron.webp',
  ton: 'networks/ton.webp',
  near: 'networks/near.webp',
  sui: 'networks/sui.webp',
  aptos: 'networks/aptos.webp',
  movement: 'networks/movement.webp',
  starknet: 'networks/starknet.webp',
  cardano: 'networks/cardano.webp',
  aleo: 'networks/aleo.webp',
  fogo: 'networks/fogo.webp',
};

/**
 * A symbol as the logo map keys it: uppercase, without NEAR Intents' trailing tag
 * ("USDT0(DEPRECATED)", "BTC(OMNI)") or a leading "$" ("$WIF").
 */
export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/_?\([^)]*\)$/, '').replace(/^\$/, '');
}

const url = (file: string) => `${import.meta.env?.BASE_URL ?? '/'}logos/${file}`;

export function tokenLogoUrl(symbol: string): string | undefined {
  const key = normalizeSymbol(symbol);
  return Object.hasOwn(TOKEN_LOGOS, key) ? url(TOKEN_LOGOS[key]) : undefined;
}

export function networkLogoUrl(network: NetworkId): string {
  return url(NETWORK_LOGOS[network]);
}

/**
 * Whether `code` is the coin of `network` on its home network — ETH on Ethereum, not ETH on Base.
 * Anywhere else an asset is drawn with the network's mark on its corner, so two rows that share a
 * symbol never look alike.
 */
export function isHomeCoin(network: NetworkId, code: string): boolean {
  return NETWORKS[network].coin === code && NETWORK_IDS.find((id) => NETWORKS[id].coin === code) === network;
}
