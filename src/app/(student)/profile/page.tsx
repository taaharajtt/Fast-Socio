import Link from "next/link";
import { Settings, Pencil, Zap, Heart } from "lucide-react";
import { ProfileTabs, type ProfileCommunity } from "@/components/profile/profile-tabs";
import { BadgeStrip } from "@/components/profile/badge-strip";
import { getEarnedBadges } from "@/lib/badges";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { AppImage } from "@/components/ui/app-image";
import { deptMeta } from "@/lib/leaderboard/departments";
import type { FeedPost } from "@/lib/feed/types";
import { semesterLabel } from "@/lib/profile/constants";
import { deriveSemester } from "@/lib/profile/semester";

export default async function ProfilePage() {
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip; RLS is authoritative.
  const me = (await getAuthUserId())!;

  const [
    { data: profile },
    { data: postRows },
    { count: matchCount },
    { data: commRows },
    { count: postCount },
    { count: eventCount },
    badges,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "full_name, username, department, bio, avatar_url, cover_url, aura_score, verified, level, xp"
      )
      .eq("id", me)
      .single(),
    // Your Posts tab shows attributed posts only — anonymous posts are kept off
    // every profile so the tab can never reveal that this account authored one
    // (matches the is_anonymous=false stats count below).
    supabase
      .from("feed_posts")
      .select("*")
      .eq("author_id", me)
      .eq("is_anonymous", false)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("matches")
      .select("id", { count: "exact", head: true })
      .or(`user_low.eq.${me},user_high.eq.${me}`),
    supabase
      .from("community_members")
      .select("community:communities(id, name, member_count, status)")
      .eq("user_id", me),
    // Stats tab counts (Refactor Phase 10).
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", me)
      .eq("is_anonymous", false),
    supabase
      .from("event_attendees")
      .select("event_id", { count: "exact", head: true })
      .eq("user_id", me),
    getEarnedBadges(supabase, me),
  ]);

  const posts = (postRows as FeedPost[]) ?? [];
  const communities = ((commRows ?? [])
    .map((r) => r.community as unknown as (ProfileCommunity & { status: string }) | null)
    .filter((c): c is ProfileCommunity & { status: string } =>
      Boolean(c) && c!.status === "approved"
    )) as ProfileCommunity[];

  const semester = deriveSemester(profile?.username);
  const deptLabel = profile?.department
    ? deptMeta(profile.department).abbr +
      (semester ? ` · ${semesterLabel(semester)}` : "")
    : "—";

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Cover banner (200px) — the user's cover photo scaled to fill, or the
          brand gradient when none is set + overlapping 80px avatar and a purple
          verified badge (UISpec V3 Screen 14). */}
      <div className="relative h-[200px]">
        {profile?.cover_url ? (
          <AppImage
            src={profile.cover_url}
            alt=""
            sizes="(max-width: 448px) 100vw, 448px"
          />
        ) : (
          <div className="h-full w-full gradient-brand opacity-80" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/20 to-transparent" />
        <Link
          href="/settings"
          aria-label="Settings"
          className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
        >
          <Settings className="h-4 w-4" aria-hidden />
        </Link>
        {profile?.full_name && (
          <span className="absolute bottom-3 left-[108px] text-[13px] font-semibold text-white/70">
            {profile.full_name}
          </span>
        )}
        <div className="absolute -bottom-10 left-4">
          <div className="relative h-20 w-20 overflow-hidden rounded-full border-[3px] border-bg bg-card">
            {profile?.avatar_url ? (
              <AppImage
                src={profile.avatar_url}
                alt={profile.full_name ?? "Avatar"}
                sizes="80px"
              />
            ) : (
              <span className="block h-full w-full" />
            )}
          </div>
        </div>
      </div>

      <main className="px-4 pb-28">
        {/* Earned badges sit in the band right of the avatar (per design) and
            double as the spacer that clears the avatar overhang. */}
        <BadgeStrip badges={badges} href="/profile/badges" />

        {profile?.verified && (
          <span
            aria-label="Verified"
            className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" aria-hidden>
              <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}

        <div className="mt-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-bold tracking-tight">
                {profile?.full_name ?? "—"}
              </h1>
              <p className="truncate text-sm text-fg-muted">{deptLabel}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/profile/edit"
                className="gradient-brand flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white"
              >
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Link>
            </div>
          </div>
        </div>

        {/* Stats — Aura (gold ⚡) + Matches (red ❤️). */}
        <div className="mb-5 mt-4 flex gap-3">
          <Link href="/profile/aura" className="flex-1 rounded-xl bg-card p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Zap className="h-4 w-4 text-gold" aria-hidden />
              <p className="text-xl font-bold">{profile?.aura_score ?? 0}</p>
            </div>
            <p className="mt-1 text-xs text-fg-muted">Aura</p>
          </Link>
          <div className="flex-1 rounded-xl bg-card p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Heart className="h-4 w-4 fill-error text-error" aria-hidden />
              <p className="text-xl font-bold">{matchCount ?? 0}</p>
            </div>
            <p className="mt-1 text-xs text-fg-muted">Matches</p>
          </div>
        </div>

        {profile?.bio && (
          <p className="mb-5 text-sm leading-relaxed text-fg">{profile.bio}</p>
        )}

        <ProfileTabs
          posts={posts}
          communities={communities}
          currentUserId={me}
          stats={{
            posts: postCount ?? 0,
            communities: communities.length,
            matches: matchCount ?? 0,
            events: eventCount ?? 0,
            aura: profile?.aura_score ?? 0,
            level: profile?.level ?? 1,
            xp: profile?.xp ?? 0,
          }}
        />
      </main>
    </div>
  );
}
