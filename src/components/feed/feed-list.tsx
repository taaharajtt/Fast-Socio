"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PostCard } from "@/components/feed/post-card";
import { fetchFeedPage, FEED_PAGE_SIZE } from "@/app/(student)/home/actions";
import type { FeedPost } from "@/lib/feed/types";

/**
 * Infinite-scrolling campus feed (P4-05). Renders the server-provided first page
 * and loads older posts by created_at cursor as the user nears the bottom, so
 * the feed keeps loading old content instead of stopping at 50.
 */
export function FeedList({ initial }: { initial: FeedPost[] }) {
  const [posts, setPosts] = useState<FeedPost[]>(initial);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(initial.length < FEED_PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);

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
    <div className="space-y-4">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {!done && (
        <div ref={sentinel} className="py-6 text-center text-sm text-fg-muted">
          {loading ? "Loading more…" : ""}
        </div>
      )}
      {done && posts.length > FEED_PAGE_SIZE && (
        <p className="py-6 text-center text-xs text-fg-muted/70">
          You&rsquo;re all caught up.
        </p>
      )}
    </div>
  );
}
