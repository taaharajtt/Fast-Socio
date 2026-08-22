import type { FeedPost } from "@/lib/feed/types";

/**
 * Pure merge rules for the campus feed.
 *
 * The feed deliberately has NO realtime subscription: every student would be
 * subscribed to every post, like and comment on campus, which is a firehose
 * that costs the most on the screen people leave open longest. What it gets
 * instead is a page-1 re-read on resume, and these are the rules that fold that
 * read into what is already on screen.
 */

/**
 * Prepend posts the list has not seen, and refresh the counts of the ones it
 * has.
 *
 * Both halves matter and only the first one used to exist:
 *
 *  - NEW POSTS are prepended (the read is newest-first, so the batch keeps its
 *    order and lands above everything older).
 *  - EXISTING POSTS take the fresh row's counts. Someone else's like or comment
 *    on a post already on screen was previously invisible until a hard reload —
 *    the optimistic path only ever updated the current user's own action.
 *
 * `existing` is otherwise left alone: the row object identity is preserved when
 * nothing changed, so untouched cards don't re-render.
 */
export function mergeFeedPage(
  existing: FeedPost[],
  fresh: FeedPost[]
): FeedPost[] {
  if (fresh.length === 0) return existing;

  const freshById = new Map(fresh.map((p) => [p.id, p]));
  const seen = new Set(existing.map((p) => p.id));

  let changed = false;
  const reconciled = existing.map((p) => {
    const next = freshById.get(p.id);
    if (!next) return p;
    if (
      next.like_count === p.like_count &&
      next.comment_count === p.comment_count &&
      next.body === p.body &&
      next.edited_at === p.edited_at
    ) {
      return p;
    }
    changed = true;
    // Counts and edits from the server; everything else (including any
    // viewer-specific optimistic flag the card owns) comes from the fresh row
    // too, since it was read for this same viewer under the same RLS.
    return next;
  });

  const added = fresh.filter((p) => !seen.has(p.id));
  if (added.length === 0) return changed ? reconciled : existing;
  return [...added, ...reconciled];
}

/**
 * Reconcile a NEWER server render against client state.
 *
 * <FeedList/> copies its `initial` prop into `useState` and never looked at it
 * again, so when React reused the component instance across a re-render with
 * fresh server data, the new rows were silently discarded. Same shape as the
 * inbox's problem, same fix: decide by content, not by prop identity, since a
 * replayed Client Cache payload is a new object holding old data.
 *
 * The server payload is page 1, so it is merged exactly like a re-read.
 */
export function reconcileServerFeed(
  clientPosts: FeedPost[],
  serverPosts: FeedPost[]
): FeedPost[] {
  if (clientPosts.length === 0) return serverPosts;
  return mergeFeedPage(clientPosts, serverPosts);
}
