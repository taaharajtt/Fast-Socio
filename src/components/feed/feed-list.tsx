"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PostCard } from "@/components/feed/post-card";
import { fetchFeedPage } from "@/app/(student)/home/actions";
import { mergeFeedPage, reconcileServerFeed } from "@/lib/feed/merge";
import { useVisibilityRefresh } from "@/lib/realtime/use-realtime-channel";
import { FEED_PAGE_SIZE, type FeedPost } from "@/lib/feed/types";

/**
 * Infinite-scrolling campus feed (P4-05). Renders the server-provided first page
 * and loads older posts by created_at cursor as the user nears the bottom, so
 * the feed keeps loading old content instead of stopping at 50.
 */
export function FeedList({
  initial,
  currentUserId,
  refreshToken = 0,
}: {
  initial: FeedPost[];
  currentUserId?: string | null;
  /** Bump to pull the newest page and prepend unseen posts (after composing). */
  refreshToken?: number;
}) {
  const [posts, setPosts] = useState<FeedPost[]>(initial);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initial.length < FEED_PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);

  // A newer server render must not be discarded. This component copied
  // `initial` into state at mount and then ignored the prop forever, so when
  // React reused the instance across a re-render carrying fresh server data,
  // those rows never reached the screen. Reconciled during render (not in an
  // effect) so they land in the first commit; `reconcileServerFeed` compares
  // content rather than identity, because a replayed Client Cache payload is a
  // new object holding old data.
  const [lastServerPosts, setLastServerPosts] = useState(initial);
  if (lastServerPosts !== initial) {
    setLastServerPosts(initial);
    setPosts((prev) => reconcileServerFeed(prev, initial));
  }

  // Targeted refresh: fetch page 1, prepend unseen posts and refresh the counts
  // of the ones already on screen. Far cheaper than router.refresh(), which
  // re-runs the layout + page as RSC.
  const refreshFirstPage = useCallback(async () => {
    const fresh = await fetchFeedPage(null);
    setPosts((prev) => mergeFeedPage(prev, fresh));
  }, []);

  useEffect(() => {
    if (!refreshToken) return;
    let active = true;
    fetchFeedPage(null).then((fresh) => {
      if (!active) return;
      setPosts((prev) => mergeFeedPage(prev, fresh));
    });
    return () => {
      active = false;
    };
  }, [refreshToken]);

  /**
   * Freshness for the feed is resume-driven, NOT realtime.
   *
   * A subscription here would mean every student listening to every post, like
   * and comment on campus — the widest possible fan-out on the screen people
   * leave open longest. Re-reading page 1 when the app comes back to the
   * foreground (throttled to once every 30s) covers the case that actually
   * bothers people: posts and counts that moved while they were away.
   *
   * `onMount: false` — a real navigation to /home has just fetched this data;
   * only a resume is evidence that it might be stale.
   */
  useVisibilityRefresh(() => void refreshFirstPage(), {
    throttleMs: 30_000,
    onMount: false,
  });

  const removePost = useCallback((id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    const cursor = posts[posts.length - 1]?.created_at ?? null;
    const next = await fetchFeedPage(cursor);
    setPosts((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...next.filter((p) => !seen.has(p.id))];
    });
    if (next.length < FEED_PAGE_SIZE) setDone(true);
    setLoading(false);
  }, [loading, done, posts]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, done]);

  if (posts.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-fg-muted">
        No posts yet. Be the first to share something.
      </p>
    );
  }

  return (
    <div>
      {posts.map((p, i) => (
        // content-visibility:auto skips layout/paint for off-screen cards
        // (CSS windowing → 60fps at scale); contain-intrinsic-size reserves an
        // estimated height so the scrollbar stays stable, and `auto` remembers
        // each card's real size after it renders once.
        <div
          key={p.id}
          className="[content-visibility:auto] [contain-intrinsic-size:auto_600px]"
        >
          <PostCard
            post={p}
            currentUserId={currentUserId}
            onDeleted={removePost}
            // Only the very first card in the whole feed is above the fold;
            // every later index (including a later loadMore page) is not.
            priority={i === 0}
          />
        </div>
      ))}
      {!done && (
        <div ref={sentinel} className="py-6 text-center text-sm text-fg-muted">
          {loading ? "Loading more…" : ""}
        </div>
      )}
      {/* End of feed (UAT-010): a friendly, animated "all caught up" marker so
          reaching the bottom feels intentional rather than broken. */}
      {done && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="animate-like-burst text-3xl" aria-hidden>
            🎉
          </div>
          <p className="text-sm font-semibold text-fg">You&rsquo;re all caught up</p>
          <p className="text-xs text-fg-muted/80">
            You&rsquo;ve seen every new post. Check back later for more.
          </p>
        </div>
      )}
    </div>
  );
}
