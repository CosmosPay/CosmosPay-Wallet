/**
 * Paying TON from the wallet's own contract: the standard wallet v4R2 whose address
 * `lib/addresses/ton.ts` derives (workchain 0, subwallet 698983191). On TON a key controls no
 * account by itself — it signs an external message to that contract, which checks the signature,
 * the subwallet id, the seqno and the expiry, then sends the internal message the payload
 * carries. A wallet is deployed by its first send: until then the account is `uninit`, and that
 * message also carries the StateInit (the v4R2 code and our data) whose hash IS the address the
 * wallet has been receiving on.
 *
 * What a public node could decide, and why it does not:
 *  - **The network.** Nothing in a v4R2 message names one (see `sendTon`), so before anything is
 *    signed the node must show the main network's zero state, and test mode is refused outright.
 *  - **The fee.** A TON message carries no fee limit: the network charges what its config says,
 *    whatever a node estimates. The estimate is held to `maxFee` before signing; a node that
 *    understates it cannot make the network charge more.
 *  - **The seqno, the account state, the balance.** A wrong seqno or a missing StateInit only makes
 *    the contract reject the message before it accepts it (which costs nothing); a balance the
 *    node overstates only makes the action fail, skipped under send mode 3 — never half-paid.
 *  - **The recipient and the amount** are ours: the internal message is built and signed here, and
 *    its bounce flag is the one the recipient's own address asks for.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base64, base64url } from '@scure/base';
import { ApiShapeError, arrayOf, num, object, parseShape, str, unchecked, type Check } from '@/lib/apiShape';
import { ChainSwapRefused } from '@/lib/chainSwap';
import { TonCellBuilder, parseBoc, serializeBoc, type TonCell } from '@/lib/send/tonCell';
import type { FamilyTransfer } from '@/lib/send/types';
import type { ChainNet } from '@/constants/chains';
import type { NetworkId } from '@/constants/networks';
import {
  TON_COMMENT_MAX_BYTES,
  TON_KEEP_ALIVE,
  TON_MAINNET_ZEROSTATE,
  TON_RATE_LIMIT_RETRIES,
  TON_REQUEST_GAP_MS,
  TON_REQUEST_TIMEOUT_MS,
  TON_SEND_MODE,
  TON_V4R2_SUBWALLET_ID,
  TON_VALID_FOR_S,
  TON_WALLET_V4R2_CODE_BOC,
} from '@/constants/tonSend';

/* ------------------------------- addresses ------------------------------- */

export interface TonAddress {
  /** 0 (the basechain, every person's wallet) or -1 (the masterchain). */
  workchain: 0 | -1;
  /** The account id: the hash of the contract's initial state. */
  account: Uint8Array;
  /** Whether a transfer here should come back if the account cannot take it. */
  bounceable: boolean;
  /** Flagged for the test network only: never a destination on mainnet. */
  testOnly: boolean;
}

/** User-friendly tags: 0x11 bounceable, 0x51 non-bounceable, either | 0x80 when test-only. */
const TAG_BOUNCEABLE = 0x11;
const TAG_NON_BOUNCEABLE = 0x51;
const TAG_TEST_ONLY = 0x80;

/** CRC-16/XMODEM, the user-friendly form's checksum (the same as `lib/addresses/ton.ts`). */
function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * A TON address as a person pastes it: user-friendly (48 characters of base64 or base64url,
 * `EQ…` / `UQ…` / `kQ…` / `0Q…`, checksum verified) or raw (`0:<64 hex>` / `-1:<64 hex>`). A raw
 * address states no bounce preference; it is read as bounceable, the form that returns the coins
 * when the destination cannot take them. Anything else is null.
 */
export function parseTonAddress(text: string): TonAddress | null {
  const raw = /^(0|-1):([0-9a-fA-F]{64})$/.exec(text);
  if (raw) {
    const account = Uint8Array.from(text.slice(raw[1].length + 1).match(/../g)!, (h) => parseInt(h, 16));
    return { workchain: raw[1] === '0' ? 0 : -1, account, bounceable: true, testOnly: false };
  }
  if (text.length !== 48) return null;
  let bytes: Uint8Array;
  try {
    // One alphabet or the other, never a mix of both.
    if (/^[A-Za-z0-9+/]{48}$/.test(text)) bytes = base64.decode(text);
    else if (/^[A-Za-z0-9_-]{48}$/.test(text)) bytes = base64url.decode(text);
    else return null;
  } catch {
    return null;
  }
  if (bytes.length !== 36 || crc16(bytes.subarray(0, 34)) !== ((bytes[34] << 8) | bytes[35])) return null;
  const testOnly = (bytes[0] & TAG_TEST_ONLY) !== 0;
  const tag = bytes[0] & ~TAG_TEST_ONLY;
  if (tag !== TAG_BOUNCEABLE && tag !== TAG_NON_BOUNCEABLE) return null;
  if (bytes[1] !== 0x00 && bytes[1] !== 0xff) return null;
  return { workchain: bytes[1] === 0 ? 0 : -1, account: bytes.slice(2, 34), bounceable: tag === TAG_BOUNCEABLE, testOnly };
}

/**
 * Whether `address` is a TON account `sendTon` would pay on `network` in `env` — the predicate
 * the screen and the signer share. An address flagged test-only is not one on mainnet: its owner
 * said it is not for real coins.
 */
export function isTonAddress(network: NetworkId, address: string, env: ChainNet): boolean {
  if (network !== 'ton') return false;
  const parsed = parseTonAddress(address);
  return parsed !== null && (env === 'testnet' || !parsed.testOnly);
}

/* -------------------------------- cells --------------------------------- */

let v4r2Code: TonCell | null = null;
/** The v4R2 code cell, parsed once from its canonical BOC. */
function walletCode(): TonCell {
  v4r2Code ??= parseBoc(base64.decode(TON_WALLET_V4R2_CODE_BOC))[0];
  return v4r2Code;
}

/**
 * The v4R2 StateInit of `publicKey`: `split_depth` and `special` absent, the code and the data
 * (seqno 0 ‖ subwallet ‖ public key ‖ an empty plugin dictionary) as references, no library.
 * Its hash is the wallet's account id.
 */
export function tonWalletStateInit(publicKey: Uint8Array): { init: TonCell; code: TonCell; data: TonCell } {
  const code = walletCode();
  const data = new TonCellBuilder().uint(0, 32).uint(TON_V4R2_SUBWALLET_ID, 32).bytes(publicKey).bit(false).end();
  const init = new TonCellBuilder().bit(false).bit(false).bit(true).bit(true).bit(false).ref(code).ref(data).end();
  return { init, code, data };
}

/**
 * A text comment, as wallets and exchanges read it: op 0 (32 bits), then the UTF-8 bytes,
 * continued in a chain of single references when they outgrow the cell ("snake" data).
 */
export function tonCommentCell(text: string): TonCell {
  const bytes = new TextEncoder().encode(text);
  // Split from the tail: each cell holds its bytes and a reference to the rest.
  const chunks: Uint8Array[] = [bytes.subarray(0, 123)];
  for (let at = 123; at < bytes.length; at += 127) chunks.push(bytes.subarray(at, at + 127));
  let tail: TonCell | null = null;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const b = new TonCellBuilder();
    if (i === 0) b.uint(0, 32);
    b.bytes(chunks[i]);
    if (tail) b.ref(tail);
    tail = b.end();
  }
  return tail!;
}

/**
 * The internal message the wallet sends (`int_msg_info$0`): IHR disabled, bounce as the
 * recipient's address asks, not bounced, no source (the network writes ours), the value in
 * nanotons and no other currency, zero IHR and forwarding fees and zero lt / time (the network
 * fills them in), no StateInit, and the comment as a referenced body when there is one.
 */
function internalTransfer(to: TonAddress, amount: bigint, comment: TonCell | null): TonCell {
  const b = new TonCellBuilder()
    .bit(false)
    .bit(true)
    .bit(to.bounceable)
    .bit(false)
    .uint(0, 2)
    .address(to.workchain, to.account)
    .coins(amount)
    .bit(false)
    .coins(0n)
    .coins(0n)
    .uint(0, 64)
    .uint(0, 32)
    .bit(false);
  return comment ? b.bit(true).ref(comment).end() : b.bit(false).end();
}

/**
 * What the key signs (the hash of this cell): subwallet id, valid_until, seqno, op 0 (a plain
 * send) and one (send_mode, message) pair — exactly the slice v4R2's `recv_external` hashes after
 * taking the 512-bit signature off.
 */
function walletPayload(seqno: number, validUntil: number, message: TonCell): TonCell {
  return new TonCellBuilder()
    .uint(TON_V4R2_SUBWALLET_ID, 32)
    .uint(validUntil, 32)
    .uint(seqno, 32)
    .uint(0, 8)
    .uint(TON_SEND_MODE, 8)
    .ref(message)
    .end();
}

const signedBody = (signature: Uint8Array, payload: TonCell): TonCell => new TonCellBuilder().bytes(signature).append(payload).end();

/**
 * The external message to our wallet (`ext_in_msg_info$10`): no source, our address, no import
 * fee, the StateInit when the wallet is not deployed yet, and the signed body as a reference.
 */
function externalMessage(wallet: Uint8Array, init: TonCell | null, body: TonCell): TonCell {
  const b = new TonCellBuilder().uint(0b10, 2).uint(0, 2).address(0, wallet).coins(0n);
  if (init) b.bit(true).bit(true).ref(init);
  else b.bit(false);
  return b.bit(true).ref(body).end();
}

/* ------------------------------- toncenter ------------------------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** toncenter's `{ ok, result }` envelope. Its error text names our address, so only its exit code is kept. */
const envelope = object({ ok: unchecked, result: unchecked });

/**
 * A non-negative integer as toncenter writes amounts: a string of digits (balances) or a JSON
 * number (fees, far below 2^53 — one past it is refused rather than read rounded). `object()`
 * hands the body back unchanged, so the value is still what the JSON held; `BigInt` reads either.
 */
const nanotons: Check<string | number> = (v, path, label) => {
  if ((typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) || (typeof v === 'string' && /^\d+$/.test(v))) return v;
  throw new ApiShapeError(label, path, 'an unsigned integer', v);
};

/**
 * The toncenter v2 calls of one send, in sequence and spaced `gapMs` apart: without a key it
 * answers about one request a second, and a 429 (which processed nothing) is tried again.
 */
function toncenter(api: string, gapMs: number) {
  let last = 0;
  return async (method: string, body?: unknown, query?: Record<string, string>): Promise<unknown> => {
    const url = `${api}/${method}${query ? `?${new URLSearchParams(query)}` : ''}`;
    for (let attempt = 0; ; attempt++) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TON_REQUEST_TIMEOUT_MS);
      let status: number;
      let json: unknown;
      try {
        const res = await fetch(url, {
          method: body === undefined ? 'GET' : 'POST',
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: ctrl.signal,
        });
        status = res.status;
        json = await res.json().catch(() => null);
      } catch (e) {
        throw new Error(`toncenter ${method}: no answer`, { cause: e });
      } finally {
        clearTimeout(timer);
      }
      if (status === 429 && attempt < TON_RATE_LIMIT_RETRIES) continue;
      const reply = json as { ok?: unknown; error?: unknown } | null;
      if (status < 200 || status >= 300 || reply?.ok !== true) {
        const exit = typeof reply?.error === 'string' ? /exit ?code[=: ]+(-?\d+)/i.exec(reply.error)?.[1] : undefined;
        throw new Error(`toncenter ${method} failed (HTTP ${status}${exit ? `, exit code ${exit}` : ''})`);
      }
      return parseShape(`toncenter ${method}`, envelope, json).result;
    }
  };
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** A base64 hash as toncenter writes it (either alphabet), as hex; anything else is ''. */
function hashHex(v: unknown): string {
  if (typeof v !== 'string') return '';
  try {
    const bytes = /[-_]/.test(v) ? base64url.decode(v) : base64.decode(v);
    return bytes.length === 32 ? bytesToHex(bytes) : '';
  } catch {
    return '';
  }
}

/* --------------------------------- send ---------------------------------- */

/**
 * Pay `p.amount` nanotons from our v4R2 wallet to `p.to`, with `p.memo` as its text comment.
 * Answers the hash of the external message the node accepted (hex): the TEP-467 normalized hash
 * (no StateInit, body by reference), which is the plain message hash on every send but a
 * wallet's first and the one indexers and explorers find the transaction by. `gapMs` spaces the
 * toncenter calls (`TON_REQUEST_GAP_MS`); only a test shortens it.
 */
export async function sendTon(p: FamilyTransfer, gapMs: number = TON_REQUEST_GAP_MS): Promise<string> {
  // The test network is refused, not served: a v4R2 transfer is not bound to a network. The
  // address is the hash of the same code and data on both, the subwallet id is the same, nothing
  // in the signed payload names the network, and the seqno is a counter that starts at 0 on both.
  // A transfer signed for the test network is therefore a valid MAIN-network transfer whenever the
  // two seqnos coincide (both fresh: the first send even deploys the wallet), and whoever sees it
  // can replay it there within its minute — moving real TON to the test recipient.
  if (p.env !== 'mainnet' || p.network !== 'ton' || p.def.balance?.kind !== 'toncenter') throw new ChainSwapRefused('chain');
  // The coin only: TON's registry lists no tokens (jettons are contracts of their own).
  if (p.asset !== 'native') throw new ChainSwapRefused('address');
  const to = parseTonAddress(p.to);
  if (!to || to.testOnly) throw new ChainSwapRefused('address');
  if (p.amount <= 0n) throw new ChainSwapRefused('minimum');
  const memo = p.memo ? p.memo : null;
  if (memo !== null && new TextEncoder().encode(memo).length > TON_COMMENT_MAX_BYTES) throw new ChainSwapRefused('memo');
  if (p.secret.length !== 32) throw new Error('A TON key is a 32-byte ed25519 seed');

  // The message goes to the wallet this key deploys; it must be the one the screen shows.
  const publicKey = ed25519.getPublicKey(p.secret);
  const { init, code, data } = tonWalletStateInit(publicKey);
  const owner = parseTonAddress(p.owner);
  if (!owner || owner.workchain !== 0 || !sameBytes(owner.account, init.hash)) {
    throw new Error('The TON key does not control the wallet address the screen shows');
  }

  const call = toncenter(p.def.balance.api, gapMs);

  // The node is the main network: its zero state, as TON's global config pins it.
  const chain = parseShape('toncenter getMasterchainInfo', object({ init: object({ root_hash: str, file_hash: str }) }), await call('getMasterchainInfo'));
  if (hashHex(chain.init.root_hash) !== TON_MAINNET_ZEROSTATE.rootHash || hashHex(chain.init.file_hash) !== TON_MAINNET_ZEROSTATE.fileHash) {
    throw new ChainSwapRefused('chain');
  }

  const wallet = parseShape(
    'toncenter getWalletInformation',
    object({ balance: nanotons, account_state: str }),
    await call('getWalletInformation', undefined, { address: p.owner }),
  );
  const balance = BigInt(wallet.balance);
  const state = wallet.account_state;
  // `uninitialized` is also what toncenter says of an account that does not exist at all.
  const deployed = state === 'active';
  if (!deployed && state !== 'uninitialized' && state !== 'nonexist') {
    // Frozen: a storage debt past the limit took the balance and the code; nothing to pay from.
    throw new ChainSwapRefused('funds');
  }
  if (!deployed && balance === 0n) throw new ChainSwapRefused('unfunded');
  // Checked before the estimate too: toncenter emulates against the real balance, and one too
  // small to buy the contract's gas stops the run early and reports a fee far below the real one
  // (seen live on an empty account). Past this line the balance covers a whole run.
  if (balance < p.amount + TON_KEEP_ALIVE) throw new ChainSwapRefused('funds');

  let seqno = 0;
  if (deployed) {
    const run = parseShape(
      'toncenter runGetMethod',
      object({ exit_code: num, stack: arrayOf(arrayOf(unchecked)) }),
      await call('runGetMethod', { address: p.owner, method: 'seqno', stack: [] }),
    );
    const top = run.stack[0];
    if (run.exit_code !== 0 || !top || top[0] !== 'num' || typeof top[1] !== 'string' || !/^0x[0-9a-fA-F]{1,8}$/.test(top[1])) {
      throw new Error('toncenter runGetMethod: no seqno');
    }
    seqno = Number.parseInt(top[1].slice(2), 16);
  }

  const validUntil = Math.floor(Date.now() / 1000) + TON_VALID_FOR_S;
  const payload = walletPayload(seqno, validUntil, internalTransfer(to, p.amount, memo === null ? null : tonCommentCell(memo)));
  const b64 = (cell: TonCell) => base64.encode(serializeBoc(cell));

  // The fee, estimated on the very payload about to be signed (a zero signature the node is told
  // not to check costs the same gas). Import, storage, gas and the transfer's forwarding are all
  // taken from our balance (send mode 1); the recipient's own processing is the recipient's. The
  // message itself carries no fee limit, so this check is the cap: a fee above it is never signed.
  const estimate = parseShape(
    'toncenter estimateFee',
    object({ source_fees: object({ in_fwd_fee: nanotons, storage_fee: nanotons, gas_fee: nanotons, fwd_fee: nanotons }) }),
    await call('estimateFee', {
      address: p.owner,
      body: b64(signedBody(new Uint8Array(64), payload)),
      ...(deployed ? {} : { init_code: b64(code), init_data: b64(data) }),
      ignore_chksig: true,
    }),
  );
  const f = estimate.source_fees;
  const fee = BigInt(f.in_fwd_fee) + BigInt(f.storage_fee) + BigInt(f.gas_fee) + BigInt(f.fwd_fee);
  if (fee > p.maxFee) throw new ChainSwapRefused('fee');
  if (balance < p.amount + fee + TON_KEEP_ALIVE) throw new ChainSwapRefused('funds');

  const signature = ed25519.sign(payload.hash, p.secret);
  const body = signedBody(signature, payload);
  await call('sendBoc', { boc: b64(externalMessage(init.hash, deployed ? null : init, body)) });
  return bytesToHex(externalMessage(init.hash, null, body).hash);
}
