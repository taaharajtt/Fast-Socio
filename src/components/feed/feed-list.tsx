"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PostCard } from "@/components/feed/post-card";
import {
  fetchFeedPage,
  fetchRankedFeedPage,
} from "@/app/(student)/home/actions";
import { cn } from "@/lib/utils";
import { FEED_PAGE_SIZE, type FeedMode, type FeedPost } from "@/lib/feed/types";

/**
 * Infinite-scrolling campus feed (P4-05 + Refactor Phase 3a).
 *
 * Two orderings, user-switchable:
 *   · "For You"  — deterministic ranking (get_ranked_feed), keyset cursor on
 *                  (rank_score, id). This is the default and the server-provided
 *                  first page.
 *   · "Latest"   — the original chronological feed, keyset cursor on created_at.
 *                  Unchanged behaviour, kept so nothing is lost.
 *
 * Duplicate posts are filtered by id on every append, so a boundary row can
 * never render twice regardless of cursor precision.
 */
export function FeedList({
  initial,
  currentUserId,
}: {
  initial: FeedPost[];
  currentUserId?: string | null;
}) {
  const [mode, setMode] = useState<FeedMode>("ranked");
  const [posts, setPosts] = useState<FeedPost[]>(initial);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initial.length < FEED_PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);

  const removePost = useCallback((id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const appendDeduped = useCallback((next: FeedPost[]) => {
    setPosts((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...next.filter((p) => !seen.has(p.id))];
    });
  }, []);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    const last = posts[posts.length - 1];
    const next =
      mode === "ranked"
        ? await fetchRankedFeedPage(last?.rank_score ?? null, last?.id ?? null)
        : await fetchFeedPage(last?.created_at ?? null);
    appendDeduped(next);
    if (next.length < FEED_PAGE_SIZE) setDone(true);
    setLoading(false);
  }, [loading, done, posts, mode, appendDeduped]);

  // Switch ordering: reset to a fresh first page of the chosen mode. "ranked"
  // reuses the server-rendered initial page to avoid a redundant round-trip.
  const switchMode = useCallback(
    async (next: FeedMode) => {
      if (next === mode) return;
      setMode(next);
      setLoading(true);
      const firstPage =
        next === "ranked"
          ? await fetchRankedFeedPage(null, null)
          : await fetchFeedPage(null);
      setPosts(firstPage);
      setDone(firstPage.length < FEED_PAGE_SIZE);
      setLoading(false);
    },
    [mode]
  );

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

  return (
    <div>
      {/* Ordering toggle (Refactor Phase 3a). */}
      <div className="mb-2 flex gap-1 px-4">
        {(
          [
            ["ranked", "For You"],
            ["latest", "Latest"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchMode(value)}
            aria-pressed={mode === value}
            className={cn(
              "rounded-[var(--radius-pill)] px-4 py-1.5 text-sm font-semibold transition-colors",
              mode === value
                ? "bg-aura text-white"
                : "glass text-fg-muted hover:text-fg"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {posts.length === 0 && !loading ? (
        <p className="py-8 text-center text-sm text-fg-muted">
          No posts yet. Be the first to share something.
        </p>
      ) : (
        posts.map((p) => (
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
            />
          </div>
        ))
      )}
      {!done && (
        <div ref={sentinel} className="py-6 text-center text-sm text-fg-muted">
          {loading ? "Loading more…" : ""}
        </div>
      )}
      {/* End of feed (UAT-010): a friendly, animated "all caught up" marker so
          reaching the bottom feels intentional rather than broken. */}
      {done && posts.length > 0 && (
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
