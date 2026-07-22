"use client";

import { useState } from "react";
import Link from "next/link";
import { Award, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PostCard } from "@/components/feed/post-card";
import { levelProgress } from "@/lib/aura/levels";
import {
  availableProfileTabs,
  resolveInitialProfileTab,
  type ProfileTab,
} from "@/lib/profile/tabs";
import type { FeedPost } from "@/lib/feed/types";

/** Community row shape the profile pages still map to derive the Stats count.
 *  (The joined-community LIST was removed from the profile; only the number
 *  remains as one Stats cell.) */
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

const TAB_LABEL: Record<ProfileTab, string> = {
  posts: "Posts",
  help: "Help",
  stats: "Stats",
};

/**
 * Posts | Help | Stats switcher on the profile screen. The old Communities tab
 * (a list of joined communities) was removed — the global Communities feature is
 * untouched. Help and Stats render only when their content is supplied, so a
 * public profile shows Posts alone while your own "Me" profile shows all three.
 * Posts render exactly like the home feed (full post cards); Help embeds the
 * complete Campus Help experience (SOCIO | ME) via the `helpContent` slot — a
 * server-rendered node passed down so a client tab switcher can host it; Stats
 * shows level/XP and activity counts.
 */
export function ProfileTabs({
  posts,
  currentUserId,
  helpContent,
  stats,
  initialTab,
  isOwnProfile = false,
}: {
  posts: FeedPost[];
  currentUserId?: string | null;
  helpContent?: ReactNode;
  stats?: ProfileStats;
  initialTab?: string;
  /**
   * Gates the Help tab. Someone else's Campus Help activity (requests, offers,
   * anonymous asks, resolved history) must never be reachable through their
   * profile, so Help renders only when this is explicitly true — even if
   * `helpContent` were ever passed by mistake on a public profile.
   */
  isOwnProfile?: boolean;
}) {
  const available = availableProfileTabs({
    help: Boolean(helpContent),
    stats: Boolean(stats),
    isOwnProfile,
  });
  const [tab, setTab] = useState<ProfileTab>(
    resolveInitialProfileTab(initialTab, available)
  );
  const [list, setList] = useState<FeedPost[]>(posts);

  return (
    <div>
      {/* Underlined switchable tabs (matches Ranks + Chat). */}
      <div className="mb-4 flex border-b border-white/[0.08]">
        {available.map((value) => {
          const active = tab === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(value)}
              className={cn(
                "relative flex flex-1 items-center justify-center pb-3 text-center text-[16px] font-semibold transition-colors",
                active ? "text-fg" : "text-fg-muted hover:text-fg"
              )}
            >
              {TAB_LABEL[value]}
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      {tab === "stats" && stats && <StatsPanel stats={stats} />}

      {tab === "help" && helpContent}

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
    </div>
  );
}

/** Stats tab (Refactor Phase 10): level/XP progress, activity counts, and a
 *  shortcut to the badges grid. */
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
        href="/profile/badges"
        className="glass flex items-center gap-3 rounded-[var(--radius-md)] p-3"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Award className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Badges</p>
          <p className="text-xs text-fg-muted">View earned badges</p>
        </div>
        <ChevronRight className="h-4 w-4 text-fg-muted" aria-hidden />
      </Link>
    </div>
  );
}
