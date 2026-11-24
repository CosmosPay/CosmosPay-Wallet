/**
 * An SVM wallet's token balances, read at its ASSOCIATED token accounts.
 *
 * Not by `getTokenAccountsByOwner`: that is an indexed query, and the keyless public node the
 * wallet reads Solana through (solana-rpc.publicnode.com) refuses every indexed request,
 * while the one that served it (api.mainnet-beta.solana.com) answers 403 to any browser
 * Origin. So each mint is read where its owner's tokens land: the associated token account,
 * derived under BOTH token programs (a mint lives under one of them, and reading both saves
 * asking which), every address in `getMultipleAccounts` calls of at most
 * `SOLANA_MULTIPLE_ACCOUNTS_MAX`.
 *
 * What it cannot see is a token account that is not the associated one. The wallet only
 * ever pays into associated accounts, and so do the wallets and exchanges that pay it.
 *
 * The rules a read keeps, the same as `lib/networkBalances.ts`: a balance that cannot be read
 * is unknown, never zero.
 *  - No account at an address holds nothing: a zero. So does a System account with no data
 *    there: lamports anyone can send to any address, the associated one included, and they
 *    open no token account. Counting that as unreadable would let 0.001 SOL sent to the
 *    unused program's address hide a wallet's balance for good.
 *  - Anything else must be owned by one of the two token programs, decode as a token
 *    account, and name that mint and this owner, or the whole read is refused.
 *  - An answer must hold exactly one entry per address asked for; a short one is not a
 *    list of accounts that do not exist.
 *
 * Transport-free: each caller hands in its own `getMultipleAccounts`, so the balance screen
 * keeps its deadline and anonymity (`lib/networkBalances.ts`) and the swap screen its node
 * (`lib/chainRpc.ts`).
 */
import { SOLANA_MULTIPLE_ACCOUNTS_MAX } from '@/constants/chains';
import {
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  decodeTokenAccount,
} from '@/lib/solanaTx';

/** One address read for a mint: its owner's associated token account under one token program. */
export interface AssociatedSlot {
  address: string;
  mint: string;
}

/** What a node answered for one address: the program that owns the account and its data, or null for none. */
export type SlotAccount = { owner: string; data: Uint8Array } | null;

/** `getMultipleAccounts` for at most `SOLANA_MULTIPLE_ACCOUNTS_MAX` addresses, answered in their order. */
export type ReadAccounts = (addresses: string[]) => Promise<readonly SlotAccount[]>;

/** Why an answer was refused. No message names an address: a caller may show it. */
export type AssociatedReadProblem = 'answer' | 'program' | 'account';

const PROBLEM_TEXT: Record<AssociatedReadProblem, string> = {
  answer: 'an answer that does not match the addresses asked for',
  program: 'an account outside the token programs',
  account: 'a token account of another mint or owner',
};

export class AssociatedReadRefused extends Error {
  // A plain field, not a parameter property: node:test runs this file with type stripping.
  readonly problem: AssociatedReadProblem;
  constructor(problem: AssociatedReadProblem) {
    super(PROBLEM_TEXT[problem]);
    this.name = 'AssociatedReadRefused';
    this.problem = problem;
  }
}

/** Each distinct mint's associated token account under SPL Token, then under Token-2022, mints in order. */
export function associatedTokenSlots(owner: string, mints: readonly string[]): AssociatedSlot[] {
  return [...new Set(mints)].flatMap((mint) =>
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((program) => ({ address: associatedTokenAddress(owner, mint, program), mint })),
  );
}

/** `items` in order, in groups of at most `size`: the calls one long `getMultipleAccounts` becomes. */
export function accountBatches<T>(items: readonly T[], size: number = SOLANA_MULTIPLE_ACCOUNTS_MAX): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('a batch holds at least one address');
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

/** What one slot's account holds of its mint; throws `AssociatedReadRefused` on anything but a zero or this owner's account of it. */
function slotAmount(owner: string, slot: AssociatedSlot, account: SlotAccount): bigint {
  if (account === null) return 0n;
  if (account.owner === SYSTEM_PROGRAM_ID && account.data.length === 0) return 0n;
  if (account.owner !== TOKEN_PROGRAM_ID && account.owner !== TOKEN_2022_PROGRAM_ID) throw new AssociatedReadRefused('program');
  const token = decodeTokenAccount(account.data);
  if (!token || token.mint !== slot.mint || token.owner !== owner) throw new AssociatedReadRefused('account');
  return token.amount;
}

/**
 * Base-unit balance of each of `mints` held by `owner`, keyed by mint: every mint asked for
 * has an entry, zero when no associated account of it exists. Throws `AssociatedReadRefused`
 * on an answer it cannot vouch for, and whatever `read` throws, unchanged.
 */
export async function readAssociatedBalances(owner: string, mints: readonly string[], read: ReadAccounts): Promise<Record<string, bigint>> {
  const out: Record<string, bigint> = {};
  const slots = associatedTokenSlots(owner, mints);
  for (const slot of slots) out[slot.mint] = 0n;
  const batches = accountBatches(slots);
  const answers = await Promise.all(batches.map((batch) => read(batch.map((s) => s.address))));
  batches.forEach((batch, i) => {
    const accounts = answers[i];
    if (!Array.isArray(accounts) || accounts.length !== batch.length) throw new AssociatedReadRefused('answer');
    batch.forEach((slot, j) => {
      out[slot.mint] += slotAmount(owner, slot, accounts[j]);
    });
  });
  return out;
}
