/**
 * Everything that talks to the Stellar network (Horizon).
 *
 * The wallet is non-custodial: transactions are built and signed locally with
 * the in-memory secret key, then submitted to Horizon. Horizon never sees the
 * secret, only the already-signed transaction envelope.
 */
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

export type StellarNetwork = 'testnet' | 'public';

interface NetConfig {
  horizon: string;
  passphrase: string;
  label: string;
  friendbot?: string;
}

export const NETWORKS: Record<StellarNetwork, NetConfig> = {
  testnet: {
    horizon: 'https://horizon-testnet.stellar.org',
    passphrase: Networks.TESTNET,
    label: 'Testnet',
    friendbot: 'https://friendbot.stellar.org',
  },
  public: {
    horizon: 'https://horizon.stellar.org',
    passphrase: Networks.PUBLIC,
    label: 'Mainnet',
  },
};

export function getServer(network: StellarNetwork): Horizon.Server {
  return new Horizon.Server(NETWORKS[network].horizon);
}

export interface TokenBalance {
  code: string; // "XLM" for native, otherwise the asset code
  issuer: string | null;
  balance: string; // human string, e.g. "123.4500000"
  isNative: boolean;
  buyingLiabilities?: string;
}

export interface AccountState {
  exists: boolean; // false until the account is funded on-chain
  balances: TokenBalance[];
  xlm: number; // native balance as a number (0 if not funded)
  subentryCount: number;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; response?: { status?: number } };
  return e?.name === 'NotFoundError' || e?.response?.status === 404;
}

/** Load balances for a public key. Brand-new keys 404 until funded — handled. */
export async function getAccountState(
  network: StellarNetwork,
  publicKey: string,
): Promise<AccountState> {
  const server = getServer(network);
  try {
    const acc = await server.loadAccount(publicKey);
    const balances: TokenBalance[] = acc.balances.map((b: any) => {
      const isNative = b.asset_type === 'native';
      return {
        code: isNative ? 'XLM' : b.asset_code,
        issuer: isNative ? null : b.asset_issuer,
        balance: b.balance,
        isNative,
        buyingLiabilities: b.buying_liabilities,
      };
    });
    const native = balances.find((b) => b.isNative);
    return {
      exists: true,
      balances,
      xlm: native ? parseFloat(native.balance) : 0,
      subentryCount: (acc as any).subentry_count ?? 0,
    };
  } catch (err) {
    if (isNotFound(err)) {
      return { exists: false, balances: [], xlm: 0, subentryCount: 0 };
    }
    throw err;
  }
}

export interface SendParams {
  network: StellarNetwork;
  secret: string;
  destination: string;
  amount: string; // in XLM
  memo?: string;
}

/** Send native XLM. Creates the destination account if it doesn't exist yet. */
export async function sendXlm({
  network,
  secret,
  destination,
  amount,
  memo,
}: SendParams): Promise<{ hash: string }> {
  const cfg = NETWORKS[network];
  const server = getServer(network);
  const keypair = Keypair.fromSecret(secret);

  const source = await server.loadAccount(keypair.publicKey());

  // Does the destination already exist? Decides createAccount vs payment.
  let destExists = true;
  try {
    await server.loadAccount(destination);
  } catch (err) {
    if (isNotFound(err)) destExists = false;
    else throw err;
  }

  let fee = BASE_FEE;
  try {
    fee = String(await server.fetchBaseFee());
  } catch {
    /* keep BASE_FEE fallback */
  }

  const builder = new TransactionBuilder(source, {
    fee,
    networkPassphrase: cfg.passphrase,
  });

  if (destExists) {
    builder.addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: normalizeAmount(amount),
      }),
    );
  } else {
    // New accounts need >= 1 XLM to meet the base reserve.
    builder.addOperation(
      Operation.createAccount({
        destination,
        startingBalance: normalizeAmount(amount),
      }),
    );
  }

  if (memo && memo.trim()) builder.addMemo(Memo.text(memo.trim().slice(0, 28)));

  const tx = builder.setTimeout(180).build();
  tx.sign(keypair);

  try {
    const res = await server.submitTransaction(tx);
    return { hash: res.hash };
  } catch (err) {
    throw new Error(parseHorizonError(err));
  }
}

/** Stellar amounts allow at most 7 decimal places. */
export function normalizeAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Importe no válido.');
  return n.toFixed(7).replace(/\.?0+$/, '') || '0';
}

function parseHorizonError(err: unknown): string {
  const e = err as {
    response?: { data?: { extras?: { result_codes?: any }; title?: string } };
    message?: string;
  };
  const codes = e?.response?.data?.extras?.result_codes;
  if (codes) {
    const op = Array.isArray(codes.operations) ? codes.operations.join(', ') : '';
    const map: Record<string, string> = {
      op_underfunded: 'Saldo insuficiente para cubrir el importe y la comisión.',
      op_no_destination: 'La cuenta de destino no existe.',
      op_low_reserve: 'El importe es menor que la reserva mínima (1 XLM) para crear la cuenta.',
      tx_insufficient_balance: 'Saldo insuficiente.',
      tx_bad_seq: 'Error de secuencia, inténtalo de nuevo.',
    };
    const key = op || codes.transaction;
    if (key && map[key]) return map[key];
    return `La red rechazó la transacción (${op || codes.transaction || 'error'}).`;
  }
  return e?.message || 'No se pudo enviar la transacción.';
}

/** Testnet only: fund a fresh account with free XLM via Friendbot. */
export async function fundWithFriendbot(
  network: StellarNetwork,
  publicKey: string,
): Promise<void> {
  const cfg = NETWORKS[network];
  if (!cfg.friendbot) {
    throw new Error('Friendbot solo está disponible en Testnet.');
  }
  const res = await fetch(`${cfg.friendbot}/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    throw new Error('No se pudo financiar la cuenta con Friendbot.');
  }
}

export function explorerTxUrl(network: StellarNetwork, hash: string): string {
  const base =
    network === 'public'
      ? 'https://stellar.expert/explorer/public/tx/'
      : 'https://stellar.expert/explorer/testnet/tx/';
  return base + hash;
}

export function explorerAccountUrl(network: StellarNetwork, pub: string): string {
  const base =
    network === 'public'
      ? 'https://stellar.expert/explorer/public/account/'
      : 'https://stellar.expert/explorer/testnet/account/';
  return base + pub;
}

/* ----------------------------- price feed ------------------------------ */

export interface PriceInfo {
  usd: number;
  change24h: number; // percent
}

const COINGECKO =
  'https://api.coingecko.com/api/v3/simple/price?ids=stellar,bitcoin,ethereum,solana,tether,usd-coin&vs_currencies=usd&include_24hr_change=true';

const CG_IDS: Record<string, string> = {
  XLM: 'stellar',
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  USDT: 'tether',
  USDC: 'usd-coin',
};

/** Best-effort price fetch. Returns {} on failure (offline / rate-limited). */
export async function getPrices(): Promise<Record<string, PriceInfo>> {
  try {
    const res = await fetch(COINGECKO, { headers: { accept: 'application/json' } });
    if (!res.ok) return {};
    const data = await res.json();
    const out: Record<string, PriceInfo> = {};
    for (const [sym, id] of Object.entries(CG_IDS)) {
      const row = data[id];
      if (row) out[sym] = { usd: row.usd ?? 0, change24h: row.usd_24h_change ?? 0 };
    }
    return out;
  } catch {
    return {};
  }
}
