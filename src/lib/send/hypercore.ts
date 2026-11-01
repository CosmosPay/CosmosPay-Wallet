/**
 * Paying on Hyperliquid's HyperCore: HYPE, or the registry's USDC, from the spot balances the
 * wallet shows (`lib/networkBalances.ts` reads `spotClearinghouseState`). The account is the
 * wallet's EVM key, and a transfer is a user-signed `spotSend` action — EIP-712 typed data
 * (domain "HyperliquidSignTransaction", version 1), POSTed as JSON to the API's `/exchange`.
 *
 * HyperCore has no public node to distrust in the usual way: its API is the exchange. What keeps
 * a signature from being used anywhere else is in the signed data itself — `hyperliquidChain`
 * ("Mainnet" / "Testnet") binds it to the network, the token is named by its id, the amount and
 * destination are strings in the message, and `time` is the nonce the exchange never accepts
 * twice. The host it is sent to is a constant per mode, never what a definition says.
 *
 * A spot transfer costs nothing, except the first one to an address HyperCore has never seen:
 * that one activates the destination for 1 USDC, paid by the sender on top of the amount. It is
 * read before signing (`preTransferCheck`), valued in HYPE at the exchange's own spot price, and
 * capped by `maxFee` like any other network's fee.
 *
 * The exchange answers an accepted transfer with `{status: "ok"}` and no id. The hash the explorer
 * knows is read back from the account's ledger (the entry carrying our nonce); if it has not
 * appeared after a few tries, the EIP-712 digest of the signed action is the answer instead —
 * an id for exactly this action, though not one the explorer resolves.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { ChainNet } from '@/constants/chains';
import { CHAIN_RPC_TIMEOUT_MS } from '@/constants/chains';
import { NETWORKS, type NetworkId } from '@/constants/networks';
import {
  HYPERCORE_ACTIVATION_FEE_MAX,
  HYPERCORE_API,
  HYPERCORE_CHAIN,
  HYPERCORE_FEE_TOKEN,
  HYPERCORE_HYPE_USDC_PAIR,
  HYPERCORE_RECEIPT_INTERVAL_MS,
  HYPERCORE_RECEIPT_TRIES,
  HYPERCORE_SIGNATURE_CHAIN_ID,
  HYPERCORE_SPOT_TOKENS,
} from '@/constants/hypercoreSend';
import { ChainSwapRefused } from '@/lib/chainSwap';
import { toChecksumAddress } from '@/lib/evmChecksum';
import { evmAddressOf } from '@/lib/evmTx';
import type { FamilyTransfer } from '@/lib/send/types';

/* --------------------------------- addresses --------------------------------- */

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Whether `address` is an account on HyperCore: a 0x address, its EIP-55 checksum checked when it
 * is written in mixed case (all lower or all upper case carries no checksum). The format names no
 * network, so `env` changes nothing.
 */
export function isHypercoreAddress(network: NetworkId, address: string, _env: ChainNet): boolean {
  if (NETWORKS[network].balance?.kind !== 'hypercore' || !EVM_ADDRESS_RE.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return toChecksumAddress(address) === address;
}

/* ---------------------------------- EIP-712 ---------------------------------- */

export interface TypedField {
  name: string;
  type: 'string' | 'uint64';
}

/** A user-signed action's primary type and fields, in the order Hyperliquid's SDKs declare them. */
export interface UserSignedType {
  primaryType: string;
  fields: readonly TypedField[];
}

/** `spotSend` (hyperliquid-python-sdk `SPOT_TRANSFER_SIGN_TYPES`, rust-sdk `SpotSend`). */
export const SPOT_SEND: UserSignedType = {
  primaryType: 'HyperliquidTransaction:SpotSend',
  fields: [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'destination', type: 'string' },
    { name: 'token', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'time', type: 'uint64' },
  ],
};

/** `usdSend` (the SDKs' `USD_SEND_SIGN_TYPES` / `UsdSend`): not sent by the wallet; its published vectors pin the encoder. */
export const USD_SEND: UserSignedType = {
  primaryType: 'HyperliquidTransaction:UsdSend',
  fields: [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'destination', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'time', type: 'uint64' },
  ],
};

const keccakText = (text: string) => keccak_256(utf8ToBytes(text));

function word(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) throw new Error('uint256 out of range');
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; v > 0n; i--, v >>= 8n) out[i] = Number(v & 0xffn);
  return out;
}

const DOMAIN_TYPEHASH = keccakText('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');

function domainSeparator(signatureChainId: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{1,16}$/.test(signatureChainId)) throw new Error('signatureChainId is a hex chain id');
  return keccak_256(
    concatBytes(
      DOMAIN_TYPEHASH,
      keccakText('HyperliquidSignTransaction'),
      keccakText('1'),
      word(BigInt(signatureChainId)),
      word(0n), // verifyingContract: the zero address
    ),
  );
}

/** The EIP-712 digest of a user-signed action: `keccak(0x19 0x01 ‖ domainSeparator ‖ hashStruct(message))`. */
export function hypercoreTypedDigest(type: UserSignedType, message: Record<string, string | bigint>, signatureChainId: string): Uint8Array {
  const typeString = `${type.primaryType}(${type.fields.map((f) => `${f.type} ${f.name}`).join(',')})`;
  const values = type.fields.map((f) => {
    const v = message[f.name];
    if (f.type === 'string') {
      if (typeof v !== 'string') throw new Error(`${f.name} is a string`);
      return keccakText(v);
    }
    if (typeof v !== 'bigint' || v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new Error(`${f.name} is a uint64`);
    return word(v);
  });
  const structHash = keccak_256(concatBytes(keccakText(typeString), ...values));
  return keccak_256(concatBytes(Uint8Array.of(0x19, 0x01), domainSeparator(signatureChainId), structHash));
}

export interface HypercoreSignature {
  r: string;
  s: string;
  v: number;
}

/** A low-s secp256k1 signature of `digest`, as the exchange takes it: 32-byte hex `r`, `s`, and `v` 27/28. */
export function signHypercoreDigest(digest: Uint8Array, secret: Uint8Array): HypercoreSignature {
  const sig = secp256k1.sign(digest, secret, { prehash: false, format: 'recovered' });
  return { r: `0x${bytesToHex(sig.subarray(1, 33))}`, s: `0x${bytesToHex(sig.subarray(33, 65))}`, v: 27 + sig[0] };
}

/* ---------------------------------- amounts ---------------------------------- */

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** A decimal string in minor units, exactly, rounded `down` (what is held) or `up` (what is owed). */
function decimalToMinor(value: unknown, decimals: number, round: 'down' | 'up', what: string): bigint {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) throw new Error(`Hyperliquid: ${what} is not a decimal`);
  const [whole, frac = ''] = value.split('.');
  const kept = BigInt(whole + frac.slice(0, decimals).padEnd(decimals, '0'));
  return round === 'up' && /[1-9]/.test(frac.slice(decimals)) ? kept + 1n : kept;
}

/**
 * Minor units as the decimal string the action signs: no exponent, no trailing zeros (the
 * exchange's signing notes warn about them), "1" rather than "1.0".
 */
export function minorToDecimal(amount: bigint, decimals: number): string {
  if (amount < 0n) throw new Error('negative amount');
  const unit = 10n ** BigInt(decimals);
  const frac = (amount % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${amount / unit}.${frac}` : `${amount / unit}`;
}

/* ------------------------------------ API ------------------------------------ */

/** One JSON POST. No credentials, no referrer: nothing about the person goes along. */
async function post(url: string, body: unknown): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAIN_RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Hyperliquid: HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } catch (e) {
    if ((e as Error).message.startsWith('Hyperliquid:')) throw e;
    throw new Error((e as Error).name === 'AbortError' ? 'Hyperliquid: timed out' : 'Hyperliquid: unreachable');
  } finally {
    clearTimeout(timer);
  }
}

const record = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`Hyperliquid: ${what} has an unexpected shape`);
  return v as Record<string, unknown>;
};

/** What is free to send of `coin`: the total less what open orders hold. A coin not listed is a known zero. */
function available(state: Record<string, unknown>, coin: string, decimals: number): bigint {
  if (!Array.isArray(state.balances)) throw new Error('Hyperliquid: the spot balances have an unexpected shape');
  const entry = (state.balances as unknown[]).map((b) => record(b, 'a spot balance')).find((b) => b.coin === coin);
  if (!entry) return 0n;
  const total = decimalToMinor(entry.total, decimals, 'down', `${coin} total`);
  const hold = entry.hold === undefined ? 0n : decimalToMinor(entry.hold, decimals, 'up', `${coin} hold`);
  return total > hold ? total - hold : 0n;
}

/** An exchange error, without the addresses it tends to echo. */
const scrub = (message: unknown) => String(message ?? '').replace(/0x[0-9a-fA-F]{40}/g, '0x…').slice(0, 160);

/** The explorer's hash of our transfer, from the ledger entry carrying its nonce; null when it has not appeared. */
async function receiptHash(info: string, owner: string, nonce: bigint, intervalMs: number): Promise<string | null> {
  for (let i = 0; i < HYPERCORE_RECEIPT_TRIES; i++) {
    if (intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const ledger = await post(info, { type: 'userNonFundingLedgerUpdates', user: owner, startTime: Number(nonce) - 60_000 });
      if (!Array.isArray(ledger)) continue;
      for (const item of ledger) {
        const entry = record(item, 'a ledger entry');
        const delta = record(entry.delta, 'a ledger delta');
        if (delta.type === 'spotTransfer' && String(delta.nonce) === String(nonce) && typeof entry.hash === 'string' && /^0x[0-9a-f]{64}$/.test(entry.hash)) {
          return entry.hash;
        }
      }
    } catch {
      // The transfer is already accepted: a failed lookup only means the digest is the answer.
    }
  }
  return null;
}

/* ------------------------------------ send ------------------------------------ */

/**
 * Send `amount` of HYPE or USDC from our HyperCore spot balance to `to`. Answers the ledger's hash
 * for the transfer (or, failing that, the signed action's digest) once the exchange accepted it.
 * `receiptIntervalMs` spaces the ledger lookups; only a test shortens it.
 */
export async function sendHypercore(p: FamilyTransfer, receiptIntervalMs: number = HYPERCORE_RECEIPT_INTERVAL_MS): Promise<string> {
  const { env, def } = p;
  const host = HYPERCORE_API[env];
  // The signature goes to the constant host of this mode and nowhere else, whatever the definition says.
  if (p.network !== 'hypercore' || def.balance?.kind !== 'hypercore' || !def.send || def.balance.api !== `${host}/info`) {
    throw new ChainSwapRefused('chain');
  }
  // Only the coin or a registry token, and only ones whose spot id is pinned here.
  const listed = p.asset === 'native' ? def : def.tokens.find((t) => t.asset === p.asset);
  const token = listed ? HYPERCORE_SPOT_TOKENS[env][p.asset] : undefined;
  if (!listed || !token) throw new ChainSwapRefused('address');
  if (listed.decimals !== token.weiDecimals) throw new Error(`Hyperliquid: ${token.name} is ${token.weiDecimals} decimals here`);
  const fee = HYPERCORE_SPOT_TOKENS[env][HYPERCORE_FEE_TOKEN];
  if (!isHypercoreAddress(p.network, p.to, env)) throw new ChainSwapRefused('address');
  if (p.amount <= 0n) throw new ChainSwapRefused('minimum');
  // A string field of the signed message: lower case, as the exchange reads it back (its signing
  // notes: an address it parses as bytes comes out lower case, and a mixed-case one would not verify).
  const destination = p.to.toLowerCase();
  const owner = evmAddressOf(p.secret).toLowerCase();
  if (owner !== p.owner.toLowerCase()) throw new Error('Hyperliquid send: the key does not control the owner account');

  const info = `${host}/info`;
  const [role, state, check] = await Promise.all([
    post(info, { type: 'userRole', user: owner }).then((r) => record(r, 'the account role')),
    post(info, { type: 'spotClearinghouseState', user: owner }).then((r) => record(r, 'the spot balances')),
    post(info, { type: 'preTransferCheck', user: destination, source: owner }).then((r) => record(r, 'the transfer check')),
  ]);
  // An address that never received anything is `missing` (asked 2026-10-29): it has nothing to send.
  if (role.role === 'missing') throw new ChainSwapRefused('unfunded');
  // An agent (API wallet), vault or sub-account key is not an account that signs its own transfers.
  if (role.role !== 'user') throw new Error('Hyperliquid send: this key is not a user account');
  if (check.isSanctioned !== false) throw new ChainSwapRefused('address');

  const activation = decimalToMinor(check.fee, fee.weiDecimals, 'up', 'the activation fee');
  if (activation > HYPERCORE_ACTIVATION_FEE_MAX) throw new ChainSwapRefused('fee');
  if (activation > 0n) {
    // The fee is in USDC and `maxFee` in HYPE: valued at the exchange's own HYPE/USDC mid.
    const mids = record(await post(info, { type: 'allMids' }), 'the mid prices');
    const price = decimalToMinor(mids[HYPERCORE_HYPE_USDC_PAIR[env]], fee.weiDecimals, 'down', 'the HYPE price');
    if (price === 0n) throw new Error('Hyperliquid: no HYPE price');
    const inCoin = (activation * 10n ** BigInt(def.decimals) + price - 1n) / price;
    if (inCoin > p.maxFee) throw new ChainSwapRefused('fee');
  }

  const sending = available(state, token.name, token.weiDecimals);
  const feeFunds = token.name === fee.name ? sending : available(state, fee.name, fee.weiDecimals);
  if (sending < p.amount) throw new ChainSwapRefused('funds');
  // The activation fee comes out of the USDC balance on top of the amount (of the same balance when sending USDC).
  if (feeFunds - (token.name === fee.name ? p.amount : 0n) < activation) throw new ChainSwapRefused('funds');

  const nonce = BigInt(Date.now());
  const message = {
    hyperliquidChain: HYPERCORE_CHAIN[env],
    destination,
    token: `${token.name}:${token.tokenId}`,
    amount: minorToDecimal(p.amount, token.weiDecimals),
    time: nonce,
  };
  const digest = hypercoreTypedDigest(SPOT_SEND, message, HYPERCORE_SIGNATURE_CHAIN_ID);
  const signature = signHypercoreDigest(digest, p.secret);
  const action = { type: 'spotSend', signatureChainId: HYPERCORE_SIGNATURE_CHAIN_ID, ...message, time: Number(nonce) };
  const answer = record(await post(`${host}/exchange`, { action, nonce: Number(nonce), signature }), 'the exchange answer');
  if (answer.status !== 'ok') {
    const why = scrub(answer.response);
    if (/insufficient/i.test(why)) throw new ChainSwapRefused('funds');
    throw new Error(`Hyperliquid refused the transfer (${why})`);
  }
  return (await receiptHash(info, owner, nonce, receiptIntervalMs)) ?? `0x${bytesToHex(digest)}`;
}
