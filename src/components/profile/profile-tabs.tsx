"use client";

import { useState } from "react";
import Link from "next/link";
import { SegmentedPills } from "@/components/ui";
import { PostCard } from "@/components/feed/post-card";
import type { FeedPost } from "@/lib/feed/types";

export type ProfileCommunity = {
  id: string;
  name: string;
  member_count: number;
};

/**
 * Posts | Communities switcher on the profile screen. Posts render exactly like
 * the home feed (UAT-021) — a scrollable list of full post cards with images and
 * text, likes, comments and share — instead of the old cramped grid.
 */
export function ProfileTabs({
  posts,
  communities,
  currentUserId,
}: {
  posts: FeedPost[];
  communities: ProfileCommunity[];
  currentUserId?: string | null;
}) {
  const [tab, setTab] = useState("posts");
  const [list, setList] = useState<FeedPost[]>(posts);

  return (
    <div>
      <SegmentedPills
        options={[
          { value: "posts", label: "Posts" },
          { value: "communities", label: "Communities" },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />

      {tab === "posts" ? (
        list.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">
            No posts yet.
          </p>
        ) : (
          // Negative margin lets the full-bleed cards match the home feed while
          // the rest of the profile stays padded.
          <div className="-mx-5 divide-y divide-glass-border border-y border-glass-border">
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
        )
      ) : communities.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">
          Not in any communities yet.
        </p>
      ) : (
        <div className="space-y-2">
          {communities.map((c) => (
            <Link
              key={c.id}
              href={`/communities/${c.id}`}
              className="glass flex items-center gap-3 rounded-[var(--radius-md)] p-3"
            >
              <span className="gradient-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg">
                👥
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                <p className="text-xs text-fg-muted">
                  {c.member_count} member{c.member_count === 1 ? "" : "s"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
