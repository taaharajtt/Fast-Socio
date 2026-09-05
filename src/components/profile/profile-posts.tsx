"use client";

import { useState } from "react";
import { PostCard } from "@/components/feed/post-card";
import type { FeedPost } from "@/lib/feed/types";

/**
 * A profile's posts. Both profile screens — your own (/profile) and someone
 * else's (/profile/[id]) — render this and nothing else below the header.
 *
 * This was `ProfileTabs`, a Posts | Stats switcher on your own profile only.
 * The Stats tab is gone: level and XP progress live on /profile/aura, matches
 * on /profile/matches and badges on /profile/badges, all of them reachable
 * from the header above — so the tab duplicated four dedicated pages behind a
 * control that existed on one of the two profile screens and not the other.
 * With one thing left to render there is nothing to switch between, so the
 * switcher, its underline and the whole tab model are gone too, and the two
 * profiles are once again the same screen (apple.md §16 — consistency).
 *
 * A stray `?tab=` in the URL is simply not read any more: nothing here varies
 * by search param, so an old /profile?tab=stats link renders this posts list.
 *
 * Client-side because the list is stateful — a deleted post is removed from it
 * in place rather than by re-fetching the page.
 */
export function ProfilePosts({
  posts,
  currentUserId,
}: {
  posts: FeedPost[];
  currentUserId?: string | null;
}) {
  const [list, setList] = useState<FeedPost[]>(posts);

  return (
    <div>
      {/* Not a tab — the section's own label, which the posts-only profile has
          always carried, with real breathing room between the bio above and
          the first post below. */}
      <p className="mb-6 mt-2 text-center text-[16px] font-semibold text-fg">
        Posts
      </p>

      {list.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">No posts yet.</p>
      ) : (
        // Negative margin lets the full-bleed cards match the home feed while
        // the rest of the profile stays padded.
        <div className="-mx-4 divide-y divide-glass-border border-b border-glass-border">
          {list.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              currentUserId={currentUserId}
              onDeleted={(id) =>
                setList((prev) => prev.filter((x) => x.id !== id))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
