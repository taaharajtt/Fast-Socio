"use client";

import { useState } from "react";
import Link from "next/link";
import { Award, ChevronRight } from "lucide-react";
import { SegmentedPills } from "@/components/ui";
import { PostCard } from "@/components/feed/post-card";
import { levelProgress } from "@/lib/aura/levels";
import type { FeedPost } from "@/lib/feed/types";

export type ProfileCommunity = {
  id: string;
  name: string;
  member_count: number;
};

export type ProfileStats = {
  posts: number;
  communities: number;
  matches: number;
  events: number;
  aura: number;
  level: number;
  xp: number;
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
  stats,
}: {
  posts: FeedPost[];
  communities: ProfileCommunity[];
  currentUserId?: string | null;
  stats?: ProfileStats;
}) {
  const [tab, setTab] = useState("posts");
  const [list, setList] = useState<FeedPost[]>(posts);

  return (
    <div>
      <SegmentedPills
        options={[
          { value: "posts", label: "Posts" },
          { value: "communities", label: "Communities" },
          ...(stats ? [{ value: "stats", label: "Stats" }] : []),
        ]}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />

      {tab === "stats" && stats && <StatsPanel stats={stats} />}

      {tab === "posts" &&
        (list.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-muted">No posts yet.</p>
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
        ))}

      {tab === "communities" &&
        (communities.length === 0 ? (
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
        ))}
    </div>
  );
}

/** Stats tab (Refactor Phase 10): level/XP progress, activity counts, and a
 *  shortcut to the achievements grid. */
function StatsPanel({ stats }: { stats: ProfileStats }) {
  const prog = levelProgress(stats.xp);
  const cells: { label: string; value: number }[] = [
    { label: "Posts", value: stats.posts },
    { label: "Matches", value: stats.matches },
    { label: "Events", value: stats.events },
    { label: "Communities", value: stats.communities },
    { label: "Aura", value: stats.aura },
    { label: "Level", value: stats.level },
  ];

  return (
    <div className="space-y-4">
      {/* Level + XP progress toward the next level. */}
      <div className="rounded-[var(--radius-card)] bg-card p-4">
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="font-semibold">Level {stats.level}</span>
          <span className="text-xs text-fg-muted">
            {prog.remaining} XP to level {stats.level + 1}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-glass">
          <div
            className="h-full rounded-full bg-aura transition-all duration-500"
            style={{ width: `${Math.round(prog.fraction * 100)}%` }}
          />
        </div>
      </div>

      {/* Activity counts. */}
      <div className="grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl bg-card p-3 text-center">
            <p className="text-xl font-bold tabular-nums">
              {c.value.toLocaleString()}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">{c.label}</p>
          </div>
        ))}
      </div>

      <Link
        href="/profile/achievements"
        className="glass flex items-center gap-3 rounded-[var(--radius-md)] p-3"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Award className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Achievements</p>
          <p className="text-xs text-fg-muted">View earned badges</p>
        </div>
        <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden />
      </Link>
    </div>
  );
}
