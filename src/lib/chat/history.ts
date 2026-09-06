import {
  compareMessages,
  isOptimisticId,
  type MergeableMessage,
  type MessageCursor,
} from "@/lib/chat/message-merge";

/**
 * Paginated history for the COMMUNITY conversation surfaces: community chat
 * rooms, event discussions and society/community broadcasts.
 *
 * WHY THESE AND NOT THE OTHERS. A DM opens on a conversation you have been
 * having; a room opens on a channel that may have thousands of messages you
 * have never read, and the loaders were fetching a flat 100 of them on every
 * entry. Discover team rooms, one-to-one DMs and group DMs are deliberately
 * untouched — they keep the load they had.
 *
 * WHAT WAS ACTUALLY BROKEN, and is fixed as a side effect: the community and
 * event loaders ordered ASCENDING and took the first 100, which is the OLDEST
 * hundred. A room with more than a hundred messages therefore opened on its
 * first hundred and could not reach the newest one at all. Paging from the
 * newest backwards is the only correct direction for a conversation, and it is
 * what this module does.
 *
 * KEYSET, NOT OFFSET. The cursor is the pair `(created_at, id)` and the
 * comparison is lexicographic on that pair — the same total order
 * `message-merge` already sorts by. Offset pagination would double-serve or
 * skip a row whenever anything is written between two pages, which in a live
 * chat room is most of the time. The id tiebreak is not decoration either: two
 * rows can share a `created_at` to the microsecond, and a cursor on the
 * timestamp alone would either loop on them forever or step over one.
 *
 * DEDUPE IS ALREADY SOLVED. A page of history is folded in with
 * `mergeMessages`, which drops ids already present and re-sorts — so a row that
 * arrives by BOTH routes (paged history and a realtime INSERT covering the same
 * window) lands once, in the right place. Nothing here needs its own set.
 */

/**
 * Messages per page, on first paint and on every "Load earlier messages".
 *
 * Ten is small on purpose: this is a phone, the rows are tall (avatar, name,
 * reactions, an optional image), and the point of the capsule is that the
 * reader chooses how far back to go.
 */
export const HISTORY_PAGE_SIZE = 10;

/**
 * FETCH ONE MORE THAN YOU SHOW.
 *
 * `hasMore` cannot be answered by "did I get a full page?" — a page that is
 * exactly full is ambiguous, and the reader is left with a capsule that fetches
 * nothing, or worse, no capsule over a room that has more. A `count: exact`
 * would answer it but costs a second scan of the table on every page.
 *
 * So the query asks for `HISTORY_PAGE_SIZE + 1` rows and this function throws
 * the extra one away: its existence IS the answer.
 */
export const HISTORY_FETCH_SIZE = HISTORY_PAGE_SIZE + 1;

export type HistoryPage<T> = {
  /** Exactly one page, in CHRONOLOGICAL (display) order. */
  items: T[];
  /** True when at least one older row exists beyond `items`. */
  hasMore: boolean;
};

/**
 * Turn a newest-first fetch of up to `size + 1` rows into a page.
 *
 * The query orders DESCENDING because "the newest N" is only expressible that
 * way; the thread renders ascending. Reversing here — once, in a tested pure
 * function — is what keeps every caller from doing it slightly differently.
 */
export function takeHistoryPage<T extends MergeableMessage>(
  fetchedNewestFirst: T[],
  size: number = HISTORY_PAGE_SIZE
): HistoryPage<T> {
  const hasMore = fetchedNewestFirst.length > size;
  const page = hasMore ? fetchedNewestFirst.slice(0, size) : fetchedNewestFirst;
  // Sort rather than reverse: the caller's `order` is the database's opinion
  // and this is ours, and they must agree with `mergeMessages` exactly or a
  // prepended page would re-sort into a different sequence on the next merge.
  return { items: [...page].sort(compareMessages), hasMore };
}

/**
 * The cursor the NEXT page of history should ask for rows before.
 *
 * The mirror of `newestServerCursor`, and it skips optimistic bubbles for the
 * same reason: their `created_at` comes from this device's clock. A bubble
 * cannot be the oldest row in practice, but a clock skewed far enough backwards
 * would make it one, and the page fetched from it would then silently skip
 * everything written in between.
 *
 * `null` means there is nothing server-backed on screen, which callers must
 * treat as "there is no history to ask for yet" — not as "fetch from the
 * beginning".
 */
export function oldestServerCursor<T extends MergeableMessage>(
  messages: T[]
): MessageCursor | null {
  let oldest: T | null = null;
  for (const m of messages) {
    if (isOptimisticId(m.id)) continue;
    if (oldest === null || compareMessages(m, oldest) < 0) oldest = m;
  }
  return oldest ? { createdAt: oldest.created_at, id: oldest.id } : null;
}

/**
 * The scroll position that keeps the reader looking at the same message after
 * older ones are prepended above it.
 *
 * Prepending grows the content ABOVE the viewport, so every pixel of new
 * content pushes what the reader is looking at down by one pixel. `scrollTop`
 * is measured from the top of the content, so adding the growth back is exactly
 * the compensation:
 *
 *     scrollTop' = scrollTop + (scrollHeight' - scrollHeight)
 *
 * It must be applied BEFORE the browser paints — `useLayoutEffect`, not
 * `useEffect` — or the reader sees one frame at the old offset, which reads as
 * the thread jumping to the oldest message and back.
 *
 * Clamped at zero: a mis-measurement (a collapsed container, a list that was
 * shorter than its viewport) must not hand the DOM a negative offset.
 */
export function restoredScrollTop({
  scrollTopBefore,
  scrollHeightBefore,
  scrollHeightAfter,
}: {
  scrollTopBefore: number;
  scrollHeightBefore: number;
  scrollHeightAfter: number;
}): number {
  const grew = scrollHeightAfter - scrollHeightBefore;
  return Math.max(0, scrollTopBefore + grew);
}

/**
 * Fold a fresh SERVER PAGE into a list that may already hold paged-in history.
 *
 * The broadcast channel re-derives its messages whenever a revalidation hands
 * down new props — that is how an edit, a delete or a pin taken on another
 * device shows up. Replacing the list wholesale is correct when the list IS the
 * server's page, and WRONG the moment the reader has loaded earlier history:
 * their ten-, twenty- or fifty-message scrollback would silently collapse back
 * to the newest page under them, mid-scroll.
 *
 * So the server's page is authoritative only over ITS OWN WINDOW — everything
 * from the oldest row it returned onwards. Rows older than that window are
 * history the reader fetched, which this revalidation says nothing about, and
 * they are kept. Inside the window the server wins, so a deleted or edited row
 * is still picked up.
 *
 * Optimistic bubbles are carried over regardless: a send still in flight when a
 * revalidation lands must not have its bubble wiped off the screen.
 */
export function reconcileWithServerWindow<T extends MergeableMessage>(
  prev: T[],
  server: T[]
): T[] {
  const optimistic = prev.filter((m) => isOptimisticId(m.id));
  if (server.length === 0) {
    // Nothing to be authoritative WITH: keep what is on screen rather than
    // blanking a thread because one revalidation came back empty.
    return prev;
  }

  const windowStart = server.reduce((oldest, m) =>
    compareMessages(m, oldest) < 0 ? m : oldest
  );
  const olderThanWindow = prev.filter(
    (m) => !isOptimisticId(m.id) && compareMessages(m, windowStart) < 0
  );

  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of [...olderThanWindow, ...server, ...optimistic]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.sort(compareMessages);
}

/**
 * The four states the "Load earlier messages" capsule can be in.
 *
 * `exhausted` is a state rather than an absence so the caller renders nothing
 * and the reader is never left tapping a control that cannot do anything.
 */
export type HistoryStatus = "idle" | "loading" | "error" | "exhausted";

/**
 * Is a fetch allowed right now?
 *
 * The guard against repeated taps, stated once and unit-tested, because "it is
 * disabled in the UI" is not the same thing: a disabled attribute is applied on
 * the next render, and two taps inside one frame both see the old one. The
 * caller holds an in-flight ref and asks this.
 */
export function canLoadEarlier({
  status,
  inFlight,
  cursor,
}: {
  status: HistoryStatus;
  inFlight: boolean;
  cursor: MessageCursor | null;
}): boolean {
  if (inFlight) return false;
  if (status === "loading" || status === "exhausted") return false;
  // `error` IS allowed through — that is the retry.
  return cursor !== null;
}
