/**
 * Pure merge rules for a chat thread's message list.
 *
 * Extracted from <ChatThread/> so the four things that were quietly wrong about
 * it can be tested without a browser or a socket:
 *
 *  1. ORDER. Realtime inserts were appended with `[...prev, m]`, which assumes
 *     events arrive in the order the rows were written. After a reconnect they
 *     do not — a catch-up fetch and a live event can land in either order — and
 *     the thread rendered messages out of sequence.
 *  2. DEDUPE. A message can now reach the list by two routes (the realtime
 *     INSERT and a catch-up fetch covering the same window), so "already
 *     present" has to be decided by id, every time.
 *  3. OPTIMISTIC RECONCILE. The old code matched a pending bubble to its
 *     authoritative row by comparing BODY TEXT (`x.body === m.body`). Sending
 *     "ok" twice in quick succession therefore reconciled the second row onto
 *     the first bubble and left a duplicate on screen. `sendMessage` now returns
 *     the inserted row's id, so the bubble is reconciled by identity instead of
 *     by guessing — no schema change, and no false match possible.
 *  4. CURSOR. A catch-up asking for `created_at > since` silently omits any row
 *     written in the SAME microsecond as the newest one already on screen. The
 *     cursor here is the pair `(created_at, id)` and the comparison is
 *     lexicographic on that pair, which is total and therefore cannot skip.
 */

export type MergeableMessage = {
  id: string;
  created_at: string;
  sender_id: string;
  /** Client-only: object-URL preview for an optimistic image while it uploads. */
  _localSrc?: string;
  [key: string]: unknown;
};

/** True for a bubble that exists only on this client, not yet in the database. */
export function isOptimisticId(id: string): boolean {
  return id.startsWith("temp-");
}

/**
 * A total order over messages: chronological, with the id breaking ties.
 *
 * The id tiebreak is not cosmetic. Two rows can share a `created_at` to the
 * microsecond, and without a second key the sort is unstable across the
 * different arrival orders realtime and catch-up produce — the same two
 * messages would swap places depending on which route delivered them first.
 */
export function compareMessages(
  a: Pick<MergeableMessage, "id" | "created_at">,
  b: Pick<MergeableMessage, "id" | "created_at">
): number {
  const at = new Date(a.created_at).getTime();
  const bt = new Date(b.created_at).getTime();
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Chronological, with id as the tiebreaker so equal timestamps are stable. */
export function sortMessages<T extends MergeableMessage>(messages: T[]): T[] {
  return [...messages].sort(compareMessages);
}

/**
 * Fold one authoritative row in: ignored if its id is already present,
 * otherwise inserted and the list re-sorted.
 *
 * Note what this deliberately does NOT do any more: it never tries to guess
 * which optimistic bubble an incoming row belongs to. That is
 * `resolveOptimistic`'s job, and it runs off the send action's own return value.
 */
export function mergeMessage<T extends MergeableMessage>(
  prev: T[],
  incoming: T
): T[] {
  if (prev.some((m) => m.id === incoming.id)) return prev;
  return sortMessages([...prev, incoming]);
}

/** Fold a batch (a catch-up fetch) in, in one pass. */
export function mergeMessages<T extends MergeableMessage>(
  prev: T[],
  incoming: T[]
): T[] {
  const seen = new Set(prev.map((m) => m.id));
  const added = incoming.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  if (added.length === 0) return prev;
  return sortMessages([...prev, ...added]);
}

/**
 * Turn an optimistic bubble into the real row, once `sendMessage` has told us
 * the id it was written under.
 *
 * Two orderings are possible and both are handled here:
 *
 *  - The action resolves FIRST (the common case): the bubble is rebranded with
 *    its real id, keeping the local image preview so it doesn't flash to a
 *    placeholder. The realtime INSERT that follows is then a plain id-duplicate
 *    and `mergeMessage` drops it.
 *  - The realtime INSERT arrives FIRST (a fast socket beats the round trip):
 *    the real row is already in the list, so the bubble is removed rather than
 *    duplicated — but its `_localSrc` is carried onto the real row first, so an
 *    image that is still resolving its signed URL keeps showing the local
 *    preview instead of blinking.
 */
export function resolveOptimistic<T extends MergeableMessage>(
  prev: T[],
  tempId: string,
  real: Partial<T> & { id: string }
): T[] {
  const tempIdx = prev.findIndex((m) => m.id === tempId);
  const realIdx = prev.findIndex((m) => m.id === real.id);

  if (realIdx >= 0) {
    if (tempIdx < 0) return prev;
    const localSrc = prev[tempIdx]._localSrc;
    const next = prev.filter((m) => m.id !== tempId);
    if (localSrc && !prev[realIdx]._localSrc) {
      return next.map((m) => (m.id === real.id ? { ...m, _localSrc: localSrc } : m));
    }
    return next;
  }

  if (tempIdx < 0) return prev;
  const next = [...prev];
  next[tempIdx] = { ...prev[tempIdx], ...real };
  return sortMessages(next);
}

/** Drop a bubble whose send failed. */
export function dropOptimistic<T extends MergeableMessage>(
  prev: T[],
  tempId: string
): T[] {
  return prev.filter((m) => m.id !== tempId);
}

/**
 * The cursor a catch-up should ask for rows after.
 *
 * It is the newest SERVER-BACKED row on screen, as a `(created_at, id)` pair.
 * Optimistic bubbles are skipped deliberately: their `created_at` comes from
 * this device's clock, which can run ahead of the database's, and using one as
 * the cursor would silently skip every message written in between.
 *
 * `null` means there is nothing server-backed on screen — an empty conversation,
 * or one whose only content is an unsent bubble. Callers must treat that as
 * "fetch the latest page", NOT as "nothing to do": an empty thread is exactly
 * the case where the first incoming message is most likely to be missed.
 */
export type MessageCursor = { createdAt: string; id: string };

export function newestServerCursor<T extends MergeableMessage>(
  messages: T[]
): MessageCursor | null {
  let newest: T | null = null;
  for (const m of messages) {
    if (isOptimisticId(m.id)) continue;
    if (newest === null || compareMessages(m, newest) > 0) newest = m;
  }
  return newest ? { createdAt: newest.created_at, id: newest.id } : null;
}
