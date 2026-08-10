import { Suspense } from "react";
import { cache } from "react";
import Link from "next/link";
import { Settings, Pencil, Zap, Heart } from "lucide-react";
import { ProfileTabs, type ProfileCommunity } from "@/components/profile/profile-tabs";
import { BadgeStrip } from "@/components/profile/badge-strip";
import { getEarnedBadges } from "@/lib/badges";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { AppImage } from "@/components/ui/app-image";
import { resolveAvatarUrl } from "@/lib/avatar";
import { Skeleton, SkeletonCards } from "@/components/ui/skeleton";
import { deptMeta } from "@/lib/leaderboard/departments";
import { FEED_COLUMNS, type FeedPost } from "@/lib/feed/types";
import { semesterLabel } from "@/lib/profile/constants";
import { deriveSemester } from "@/lib/profile/semester";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

// No `unstable_instant` export here — it only adds build-time validation, and
// that validation currently trips on @sentry/nextjs reading the `sentry-trace`
// header during every server render. See the note in next.config.ts; the static
// shell itself is unaffected (this route builds as Partial Prerender).

/**
 * Your own profile.
 *
 * Structured so the page arrives in the order it is read. The cover band, the
 * Settings and Edit affordances and the section geometry are the same on every
 * visit and prerender into the shell. Then the hero (cover art, avatar, name,
 * department) streams as one small single-row read, and the heavier tail —
 * badges, counts, your posts, your communities — streams behind it, so the top
 * of the page is never waiting on the bottom of it.
 *
 * Every slot reads the profile row through `loadProfile`, which is
 * request-memoized: three components, one query.
 */
export default function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  return (
    <div className="mx-auto w-full max-w-md -mt-[var(--safe-top)]">
      {/* Cover banner (200px) — the user's cover photo scaled to fill, or the
          brand gradient when none is set + overlapping 80px avatar and a purple
          verified badge (UISpec V3 Screen 14). This hero is intentionally
          full-bleed and bleeds under the status bar, so the container cancels
          the shell's top safe-area inset above; the floating Settings control
          pays that inset back itself so it isn't hidden behind the notch. */}
      <div className="relative h-[200px]">
        <Suspense fallback={<div className="h-full w-full gradient-brand opacity-80" />}>
          <CoverArt />
        </Suspense>
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/20 to-transparent" />
        <Link
          href="/settings"
          aria-label="Settings"
          className="absolute right-4 top-[max(1rem,calc(var(--safe-top)+0.5rem))] flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
        >
          <Settings className="h-4 w-4" aria-hidden />
        </Link>
        <div className="absolute -bottom-10 left-4">
          <div className="relative h-20 w-20 overflow-hidden rounded-full border-[3px] border-bg bg-card">
            <Suspense fallback={<span className="block h-full w-full" />}>
              <Avatar />
            </Suspense>
          </div>
        </div>
      </div>

      <main className="px-4 pb-6">
        {/* Earned badges sit in the band right of the avatar (per design) and
            double as the spacer that clears the avatar overhang — so the
            fallback is an EMPTY strip, not nothing, or the name below would
            jump up under the avatar while badges load. */}
        <Suspense fallback={<BadgeStrip badges={[]} />}>
          <Badges />
        </Suspense>

        <Suspense fallback={<IdentitySkeleton />}>
          <Identity />
        </Suspense>

        <Suspense fallback={<StatsSkeleton />}>
          <Stats />
        </Suspense>

        <Suspense fallback={null}>
          <Bio />
        </Suspense>

        <Suspense fallback={<SkeletonCards count={3} />}>
          <Tabs searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

/** The viewer's own profile row. Memoized for the request so the cover, name,
 *  avatar, identity block, stats and tabs share a single read. */
const loadProfile = cache(async () => {
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip; RLS is authoritative.
  const me = (await getAuthUserId())!;
  const { data } = await supabase
    .from("profiles")
    .select(
      "full_name, username, department, degree, bio, avatar_url, gender, cover_url, aura_score, verified, level, xp"
    )
    .eq("id", me)
    .single();
  return { me, profile: data };
});

async function CoverArt() {
  const { profile } = await loadProfile();
  return profile?.cover_url ? (
    <AppImage
      src={profile.cover_url}
      alt=""
      sizes="(max-width: 448px) 100vw, 448px"
      priority
    />
  ) : (
    <div className="h-full w-full gradient-brand opacity-80" />
  );
}

async function Avatar() {
  const { profile } = await loadProfile();
  const src = resolveAvatarUrl(profile?.avatar_url, profile?.gender);
  if (!src) return <span className="block h-full w-full" />;
  return (
    <AppImage src={src} alt={profile?.full_name ?? "Avatar"} sizes="80px" priority />
  );
}

async function Badges() {
  const supabase = await createClient();
  const { me } = await loadProfile();
  const badges = await getEarnedBadges(supabase, me);
  return <BadgeStrip badges={badges} href="/profile/badges" />;
}

/** Verified tick, name, department line, Edit button and bio. */
async function Identity() {
  const { profile } = await loadProfile();

  const semester = deriveSemester(profile?.username);
  const deptLabel = profile?.department
    ? [
        deptMeta(profile.department).abbr,
        profile.degree,
        semester ? semesterLabel(semester) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "—";

  return (
    <>
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

    </>
  );
}

/** Bio sits BELOW the stat cards (UISpec V3 Screen 14), so it is its own slot
 *  rather than part of the identity block above them. */
async function Bio() {
  const { profile } = await loadProfile();
  if (!profile?.bio) return null;
  return <p className="mb-5 text-sm leading-relaxed text-fg">{profile.bio}</p>;
}

function IdentitySkeleton() {
  return (
    <div className="mt-1 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-[22px] w-40" />
        <Skeleton className="mt-2 h-4 w-28" />
      </div>
      <Skeleton className="h-9 w-20 rounded-full" />
    </div>
  );
}

/** Stats — Aura (gold ⚡) + Matches (red ❤️). */
async function Stats() {
  const supabase = await createClient();
  const { me, profile } = await loadProfile();
  // Own matches: RLS on `matches` already lets you see every row you're a party
  // to, so a direct count is accurate here — but the same RPC used on public
  // profiles works just as well and keeps both pages consistent.
  const { data: matchCount } = await supabase.rpc("get_match_count", {
    p_user_id: me,
  });

  return (
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
  );
}

function StatsSkeleton() {
  return (
    <div className="mb-5 mt-4 flex gap-3">
      <Skeleton className="h-[70px] flex-1 rounded-xl" />
      <Skeleton className="h-[70px] flex-1 rounded-xl" />
    </div>
  );
}

async function Tabs({ searchParams }: { searchParams: Promise<SP> }) {
  const supabase = await createClient();
  const { me, profile } = await loadProfile();
  const sp = await searchParams;
  const initialTab = one(sp.tab);

  const [
    { data: postRows },
    { data: matchCount },
    { data: commRows },
    // `rpc()` returns its scalar in `data` — NOT in `count`, which PostgREST only
    // populates for `.select()` with a count option. Destructuring `count` here
    // silently yielded undefined -> `?? 0` -> a permanent zero (fix-036/fix-042 round 2).
    { data: postCount },
    { count: eventCount },
  ] = await Promise.all([
    // Your Posts tab shows attributed posts only — anonymous posts are kept off
    // every profile so the tab can never reveal that this account authored one
    // (matches the is_anonymous=false stats count below).
    supabase
      .from("feed_posts")
      .select(FEED_COLUMNS)
      .eq("author_id", me)
      .eq("is_anonymous", false)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.rpc("get_match_count", { p_user_id: me }),
    supabase
      .from("community_members")
      .select("community:communities(id, name, member_count, status)")
      .eq("user_id", me),
    // Stats tab counts (Refactor Phase 10). This MUST go through the definer
    // RPC: `posts` has RLS on with no SELECT policy, so counting the table
    // directly returned 0 for everyone, forever (fix-036, mig 0133).
    supabase.rpc("get_profile_post_count", { p_user: me }),
    supabase
      .from("event_attendees")
      .select("event_id", { count: "exact", head: true })
      .eq("user_id", me),
  ]);

  const posts = (postRows as unknown as FeedPost[]) ?? [];
  const communities = ((commRows ?? [])
    .map((r) => r.community as unknown as (ProfileCommunity & { status: string }) | null)
    .filter((c): c is ProfileCommunity & { status: string } =>
      Boolean(c) && c!.status === "approved"
    )) as ProfileCommunity[];

  return (
    <ProfileTabs
      posts={posts}
      currentUserId={me}
      initialTab={initialTab}
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
  );
}
