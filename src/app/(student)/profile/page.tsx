import Link from "next/link";
import { Settings, Pencil, Plus, Zap, Heart, Bookmark } from "lucide-react";
import { ProfileTabs, type ProfileCommunity } from "@/components/profile/profile-tabs";
import { ShareProfileButton } from "@/components/profile/share-profile-button";
import { createClient } from "@/lib/supabase/server";
import { AppImage } from "@/components/ui/app-image";
import { deptMeta } from "@/lib/leaderboard/departments";
import type { FeedPost } from "@/lib/feed/types";

/** 1 → "1st", 6 → "6th" (UISpec V3 "6th Semester"). */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const [
    { data: profile },
    { data: postRows },
    { count: matchCount },
    { data: commRows },
    { count: postCount },
    { count: eventCount },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "full_name, department, semester, bio, avatar_url, cover_url, aura_score, verified, level, xp, completeness"
      )
      .eq("id", me)
      .single(),
    supabase
      .from("feed_posts")
      .select("*")
      .eq("author_id", me)
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
  ]);

  const posts = (postRows as FeedPost[]) ?? [];
  const communities = ((commRows ?? [])
    .map((r) => r.community as unknown as (ProfileCommunity & { status: string }) | null)
    .filter((c): c is ProfileCommunity & { status: string } =>
      Boolean(c) && c!.status === "approved"
    )) as ProfileCommunity[];

  const deptLabel = profile?.department
    ? deptMeta(profile.department).abbr +
      (profile.semester ? ` · ${ordinal(profile.semester)} Semester` : "")
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
        {profile?.verified && (
          <span
            aria-label="Verified"
            className="mt-12 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white"
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

        <div className={profile?.verified ? "mt-1" : "mt-12"}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-bold tracking-tight">
                {profile?.full_name ?? "—"}
              </h1>
              <p className="truncate text-sm text-fg-muted">{deptLabel}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ShareProfileButton profileId={me} />
              <Link
                href="/profile/edit"
                className="gradient-brand flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white"
              >
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Link>
              <Link
                href="/profile/saved"
                aria-label="Saved posts"
                className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted hover:text-fg"
              >
                <Bookmark className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/home"
                aria-label="Create post"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white"
              >
                <Plus className="h-4 w-4" aria-hidden />
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

        {/* Profile completeness meter (Refactor Phase 10). Nudges toward the 90%
            bonus while staying quiet once complete. */}
        {typeof profile?.completeness === "number" && profile.completeness < 100 && (
          <div className="mb-5">
            <div className="mb-1 flex items-center justify-between text-xs text-fg-muted">
              <span>Profile {profile.completeness}% complete</span>
              <Link href="/profile/edit" className="font-medium text-accent">
                Complete it
              </Link>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-glass">
              <div
                className="h-full rounded-full bg-aura transition-all duration-500"
                style={{ width: `${profile.completeness}%` }}
              />
            </div>
          </div>
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
