"use client";

import { useCallback, useState } from "react";
import { PostCard } from "@/components/feed/post-card";
import type { FeedPost } from "@/lib/feed/types";

/**
 * Static list of bookmarked posts (Refactor Phase 3b). Unlike the main feed
 * this has no ranked/latest toggle and no infinite pagination — the saved set
 * is small and server-rendered. Deleting a post drops it from the list in place.
 */
export function SavedPostsList({
  initial,
  currentUserId,
}: {
  initial: FeedPost[];
  currentUserId?: string | null;
}) {
  const [posts, setPosts] = useState<FeedPost[]>(initial);

  const removePost = useCallback((id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return (
    <div>
      {posts.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          currentUserId={currentUserId}
          onDeleted={removePost}
        />
      ))}
    </div>
  );
}
