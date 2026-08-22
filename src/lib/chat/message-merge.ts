/**
 * Pure merge rules for a chat thread's message list.
 *
 * Extracted from <ChatThread/> so the three things that were quietly wrong
 * about it can be tested without a browser or a socket:
 *
 *  1. ORDER. Realtime inserts were appended with `[...prev, m]`, which assumes
 *     events arrive in the order the rows were written. After a reconnect they
 *     do not — a catch-up fetch and a live event can land in either order — and
 *     the thread rendered messages out of sequence.
 *  2. DEDUPE. A message can now reach the list by two routes (the realtime
 *     INSERT and the catch-up fetch covering the same window), so "already
 *     present" has to be decided by id, every time.
 *  3. OPTIMISTIC RECONCILE. The old code matched a pending bubble to its
 *     authoritative row by comparing BODY TEXT (`x.body === m.body`). Sending
 *     "ok" twice in quick succession therefore reconciled the second row onto
 *     the first bubble and left a duplicate on screen. `sendMessage` now
 *     returns the inserted row's id, so the bubble is reconciled by identity
 *     instead of by guessing — no schema change, and no false match possible.
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

/** Chronological, with id as the tiebreaker so equal timestamps are stable. */
export function sortMessages<T extends MergeableMessage>(messages: T[]): T[] {
  return [...messages].sort((a, b) => {
    const at = new Date(a.created_at).getTime();
    const bt = new Date(b.created_at).getTime();
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Fold one authoritative row in: ignored if its id is already present,
 * otherwise inserted and the list re-sorted.
 *
 * Note what this deliberately does NOT do any more: it never tries to guess
 * which optimistic bubble an incoming row belongs to. That is `resolveOptimistic`'s
 * job, and it runs off the send action's own return value.
 */
export function mergeMessage<T extends MergeableMessage>(
  prev: T[],
  incoming: T
): T[] {
  if (prev.some((m) => m.id === incoming.id)) return prev;
  return sortMessages([...prev, incoming]);
}

/** Fold a batch (a catch-up fetch) in. */
export function mergeMessages<T extends MergeableMessage>(
  prev: T[],
  incoming: T[]
): T[] {
  return incoming.reduce<T[]>((acc, m) => mergeMessage(acc, m), prev);
}

/**
 * Turn an optimistic bubble into the real row, once `sendMessage` has told us
 * the id it was written under.
 *
 * Two orderings are possible and both are handled here:
 *
 *  - The action resolves FIRST (the common case): the bubble is rebranded with
 *    its real id, keeping the local image preview so it doesn't flash. The
 *    realtime INSERT that follows is then a plain id-duplicate and is dropped.
 *  - The realtime INSERT arrives first (a fast socket beats the round trip):
 *    the real row is already in the list, so the bubble is simply removed
 *    instead of being duplicated.
 */
export function resolveOptimistic<T extends MergeableMessage>(
  prev: T[],
  tempId: string,
  real: Partial<T> & { id: string }
): T[] {
  const alreadyReal = prev.some((m) => m.id === real.id);
  if (alreadyReal) return prev.filter((m) => m.id !== tempId);

  const idx = prev.findIndex((m) => m.id === tempId);
  if (idx < 0) return prev;

  const next = [...prev];
  next[idx] = { ...prev[idx], ...real };
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
 * The timestamp a catch-up should ask for rows newer than: the newest
 * SERVER-BACKED row on screen.
 *
 * Optimistic bubbles are skipped deliberately — their `created_at` comes from
 * the client's clock, which can run ahead of the database's. Using one as the
 * cursor would silently skip every message written in between.
 */
export function newestServerTimestamp<T extends MergeableMessage>(
  messages: T[]
): string | null {
  let newest: string | null = null;
  for (const m of messages) {
    if (isOptimisticId(m.id)) continue;
    if (newest === null || new Date(m.created_at) > new Date(newest)) {
      newest = m.created_at;
    }
  }
  return newest;
}
