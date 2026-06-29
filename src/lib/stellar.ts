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

// A network is identified by an id; built-ins are testnet/public, plus any
// custom networks the user adds (own Horizon + passphrase).
export type StellarNetwork = string;

export interface NetConfig {
  id: string;
  label: string;
  horizon: string;
  passphrase: string;
  friendbot?: string;
  custom?: boolean;
}

export const BUILTIN_NETWORKS: NetConfig[] = [
  {
    id: 'testnet',
    label: 'Testnet',
    horizon: 'https://horizon-testnet.stellar.org',
    passphrase: Networks.TESTNET,
    friendbot: 'https://friendbot.stellar.org',
  },
  {
    id: 'public',
    label: 'Mainnet',
    horizon: 'https://horizon.stellar.org',
    passphrase: Networks.PUBLIC,
  },
];

/** All available networks (built-ins + the user's custom ones). */
export function allNetworks(custom: NetConfig[]): NetConfig[] {
  return [...BUILTIN_NETWORKS, ...custom];
}

/** Resolve a network id to its config (falls back to testnet). */
export function resolveNetwork(id: string, custom: NetConfig[]): NetConfig {
  return allNetworks(custom).find((n) => n.id === id) ?? BUILTIN_NETWORKS[0];
}

export function getServer(cfg: NetConfig): Horizon.Server {
  return new Horizon.Server(cfg.horizon);
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
  cfg: NetConfig,
  publicKey: string,
): Promise<AccountState> {
  const server = getServer(cfg);
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
  cfg: NetConfig;
  secret: string;
  destination: string;
  amount: string; // in XLM
  memo?: string;
}

/** Send native XLM. Creates the destination account if it doesn't exist yet. */
export async function sendXlm({
  cfg,
  secret,
  destination,
  amount,
  memo,
}: SendParams): Promise<{ hash: string }> {
  const server = getServer(cfg);
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

export interface PaymentParams {
  cfg: NetConfig;
  secret: string;
  destination: string;
  amount: string;
  memo?: string;
  /** null/undefined = native XLM; otherwise a credit asset (requires dest trustline). */
  asset?: { code: string; issuer: string } | null;
}

/**
 * Send a payment in any asset. Native XLM creates the destination account when
 * it doesn't exist yet; credit assets require the destination to exist and to
 * already trust the asset (otherwise Horizon rejects with op_no_trust).
 */
export async function sendPayment({
  cfg,
  secret,
  destination,
  amount,
  memo,
  asset,
}: PaymentParams): Promise<{ hash: string }> {
  if (!asset || asset.code === 'XLM' || !asset.issuer) {
    return sendXlm({ cfg, secret, destination, amount, memo });
  }
  const server = getServer(cfg);
  const keypair = Keypair.fromSecret(secret);
  const source = await server.loadAccount(keypair.publicKey());

  let fee = BASE_FEE;
  try {
    fee = String(await server.fetchBaseFee());
  } catch {
    /* keep BASE_FEE fallback */
  }

  const builder = new TransactionBuilder(source, { fee, networkPassphrase: cfg.passphrase }).addOperation(
    Operation.payment({
      destination,
      asset: new Asset(asset.code, asset.issuer),
      amount: normalizeAmount(amount),
    }),
  );
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

/* ----------------------- raw transaction signing ----------------------- */

export interface TxSummary {
  source: string;
  fee: string;
  memo: string;
  operations: string[]; // operation type names
  signatures: number;
}

/** Decode an XDR envelope for display (does not sign). Throws on malformed input. */
export function inspectXdr(cfg: NetConfig, xdr: string): TxSummary {
  const tx: any = TransactionBuilder.fromXDR(xdr.trim(), cfg.passphrase);
  const ops: any[] = Array.isArray(tx.operations) ? tx.operations : [];
  let memo = '';
  try {
    if (tx.memo && tx.memo.value != null) memo = tx.memo.value.toString();
  } catch {
    /* non-text memo */
  }
  return {
    source: tx.source ?? '',
    fee: String(tx.fee ?? ''),
    memo,
    operations: ops.map((o) => String(o.type)),
    signatures: Array.isArray(tx.signatures) ? tx.signatures.length : 0,
  };
}

/** Sign an XDR with the active secret and return the signed XDR (base64). */
export function signXdr(cfg: NetConfig, secret: string, xdr: string): string {
  const tx = TransactionBuilder.fromXDR(xdr.trim(), cfg.passphrase);
  tx.sign(Keypair.fromSecret(secret));
  return tx.toXDR();
}

/** Submit a (signed) XDR envelope to the network. */
export async function submitXdr(cfg: NetConfig, xdr: string): Promise<{ hash: string }> {
  const server = getServer(cfg);
  const tx = TransactionBuilder.fromXDR(xdr.trim(), cfg.passphrase);
  try {
    const res = await server.submitTransaction(tx as any);
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
export async function fundWithFriendbot(cfg: NetConfig, publicKey: string): Promise<void> {
  if (!cfg.friendbot) {
    throw new Error('Friendbot solo está disponible en Testnet.');
  }
  const res = await fetch(`${cfg.friendbot}/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    throw new Error('No se pudo financiar la cuenta con Friendbot.');
  }
}

/** Add (or remove, with limit '0') a trustline so the account can hold an asset. */
export async function addTrustline({
  cfg,
  secret,
  code,
  issuer,
  limit,
}: {
  cfg: NetConfig;
  secret: string;
  code: string;
  issuer: string;
  limit?: string;
}): Promise<{ hash: string }> {
  const server = getServer(cfg);
  const keypair = Keypair.fromSecret(secret);
  const source = await server.loadAccount(keypair.publicKey());

  let fee = BASE_FEE;
  try {
    fee = String(await server.fetchBaseFee());
  } catch {
    /* fallback */
  }

  const tx = new TransactionBuilder(source, { fee, networkPassphrase: cfg.passphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset(code, issuer), limit }))
    .setTimeout(180)
    .build();
  tx.sign(keypair);

  try {
    const res = await server.submitTransaction(tx);
    return { hash: res.hash };
  } catch (err) {
    throw new Error(parseHorizonError(err));
  }
}

/**
 * Resolve the canonical issuer for an asset code on this network by asking
 * Horizon which issuer has the most holders. Avoids hard-coding issuers that
 * differ between mainnet/testnet (and lets testnet variants resolve too).
 * Returns null when no issuer for that code exists on the network.
 */
export async function resolveAssetIssuer(cfg: NetConfig, code: string): Promise<string | null> {
  const server = getServer(cfg);
  try {
    const res = await server.assets().forCode(code).limit(200).call();
    const recs = ((res as any).records ?? []) as any[];
    if (!recs.length) return null;
    const score = (r: any) =>
      Number(r.accounts?.authorized ?? 0) +
      Number(r.accounts?.authorized_to_maintain_liabilities ?? 0) +
      Number(r.num_claimable_balances ?? 0);
    recs.sort((a, b) => score(b) - score(a));
    return recs[0]?.asset_issuer ?? null;
  } catch {
    return null;
  }
}

/** stellar.expert only knows the built-in networks; custom networks have no explorer. */
function explorerSegment(cfg: NetConfig): string | null {
  if (cfg.id === 'public') return 'public';
  if (cfg.id === 'testnet') return 'testnet';
  return null;
}

export function explorerTxUrl(cfg: NetConfig, hash: string): string {
  const seg = explorerSegment(cfg);
  return seg ? `https://stellar.expert/explorer/${seg}/tx/${hash}` : '';
}

export function explorerAccountUrl(cfg: NetConfig, pub: string): string {
  const seg = explorerSegment(cfg);
  return seg ? `https://stellar.expert/explorer/${seg}/account/${pub}` : '';
}

/* ----------------------------- price feed ------------------------------ */

export interface PriceInfo {
  usd: number;
  change24h: number; // percent
}

// Stellar-ecosystem assets only.
const COINGECKO =
  'https://api.coingecko.com/api/v3/simple/price?ids=stellar,usd-coin,euro-coin,aquarius&vs_currencies=usd&include_24hr_change=true';

// USDT does not exist as a native Stellar asset — Stellar's fiat stables are USDC & EURC.
const CG_IDS: Record<string, string> = {
  XLM: 'stellar',
  USDC: 'usd-coin',
  EURC: 'euro-coin',
  AQUA: 'aquarius',
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
