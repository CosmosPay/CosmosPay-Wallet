/**
 * The notifications bell (features/wallet/HomeNotifications.tsx): what happened to the account
 * — payments in and out, swaps, its creation — newest first, and which of it arrived since the
 * person last opened the bell. Read from the history Home already loads; nothing is fetched and
 * nothing is pushed, so the bell is as fresh as the activity list beside it.
 *
 * "Seen" is a timestamp per wallet and network: the newest operation's time when the panel was
 * last opened. A wallet that has none yet starts at "everything seen" — a first open must not
 * announce the whole history as new.
 */
import { NOTIFY_KINDS, NOTIFY_ROWS, NOTIFY_SEEN_KEY } from '@/constants/home';
import { storageGet, storageSet } from '@/lib/storage';
import type { HistoryOp } from '@/lib/stellar';

export function notificationsOf(history: readonly HistoryOp[]): HistoryOp[] {
  return history.filter((op) => NOTIFY_KINDS.has(op.kind)).slice(0, NOTIFY_ROWS);
}

/** Newer than what was seen. With nothing seen yet, nothing is new. */
export function isUnread(op: HistoryOp, seenAt: string | null): boolean {
  return seenAt !== null && Date.parse(op.createdAt) > Date.parse(seenAt);
}

export function unreadCount(items: readonly HistoryOp[], seenAt: string | null): number {
  return items.filter((op) => isUnread(op, seenAt)).length;
}

const seenScope = (walletId: string, networkId: string) => `${walletId}:${networkId}`;

async function readMap(): Promise<Record<string, string>> {
  try {
    const raw = await storageGet(NOTIFY_SEEN_KEY);
    const map = raw ? (JSON.parse(raw) as unknown) : {};
    return map && typeof map === 'object' ? (map as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** When this wallet last looked on this network; a first look is recorded as now. */
export async function readSeen(walletId: string, networkId: string, now = new Date()): Promise<string> {
  const map = await readMap();
  const at = map[seenScope(walletId, networkId)];
  if (typeof at === 'string' && !Number.isNaN(Date.parse(at))) return at;
  await writeSeen(walletId, networkId, now.toISOString());
  return now.toISOString();
}

export async function writeSeen(walletId: string, networkId: string, at: string): Promise<void> {
  const map = await readMap();
  map[seenScope(walletId, networkId)] = at;
  await storageSet(NOTIFY_SEEN_KEY, JSON.stringify(map));
}
