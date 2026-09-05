import { Suspense } from "react";
import { cache } from "react";
import Link from "next/link";
import { Settings, Pencil } from "lucide-react";
import { ProfilePosts } from "@/components/profile/profile-posts";
import { BadgeStrip } from "@/components/profile/badge-strip";
import {
  CoverFallback,
  ProfileStats,
  ProfileVerifiedTick,
} from "@/components/profile/hero";
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
 * badges, counts, your posts — streams behind it, so the top of the page is
 * never waiting on the bottom of it.
 *
 * There is no tab switcher: this screen is Posts-only, exactly like a public
 * profile. The Stats tab it used to carry is gone — its level/XP progress is
 * /profile/aura, its counts are the Aura and Matches cards above (which link
 * to those pages), and its badges shortcut is the badge strip. Nothing here
 * reads a search param, so a legacy /profile?tab=stats link renders this page
 * unchanged.
 *
 * Every slot reads the profile row through `loadProfile`, which is
 * request-memoized: three components, one query.
 */
export default function ProfilePage() {
  return (
    <div className="mx-auto w-full max-w-md -mt-[var(--safe-top)]">
      {/* Cover banner (150px) — the user's cover photo scaled to fill, or a
          neutral tonal field when none is set, plus the overlapping 80px avatar
          and its verified badge. Shortened from 200px: the banner is
          atmosphere, and 200px of it pushed the name — the thing this screen is
          actually about — most of the way down the first screenful. This hero is
          intentionally
          full-bleed and bleeds under the status bar, so the container cancels
          the shell's top safe-area inset above; the floating Settings control
          pays that inset back itself so it isn't hidden behind the notch. */}
      <div className="relative h-[150px]">
        <Suspense fallback={<CoverFallback />}>
          <CoverArt />
        </Suspense>
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/20 to-transparent" />
        {/* A control floating on a photograph needs its own material to stay
            legible over whatever the cover happens to be (apple.md §12). */}
        <Link
          href="/settings"
          aria-label="Settings"
          className="material-bar pressable focus-ring absolute right-4 top-[max(1rem,calc(var(--safe-top)+0.5rem))] flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white"
        >
          <Settings className="h-5 w-5" aria-hidden />
        </Link>
        <div className="absolute -bottom-10 left-4">
          {/* The verified tick sits on the avatar's corner rather than floating
              as a loose 20px disc above the name, which is where it used to
              land — an unanchored mark that read as an unexplained bullet.
              Anchoring it to the face makes what it certifies obvious
              (apple.md §16 — proximity implies relationship). It has to be a
              SIBLING of the clipped circle, not a child, or `overflow-hidden`
              would cut it off. */}
          <div className="relative h-20 w-20">
            {/* `relative` is load-bearing: AppImage renders with `fill`, so it
                positions against the nearest positioned ancestor. Without it
                the image escaped this rounded, clipped box and anchored to the
                wrapper instead — the avatar rendered as a square. */}
            <div className="relative h-full w-full overflow-hidden rounded-full border-[3px] border-bg bg-card">
              <Suspense fallback={<span className="block h-full w-full" />}>
                <Avatar />
              </Suspense>
            </div>
            <Suspense fallback={null}>
              <VerifiedTick />
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
          <Posts />
        </Suspense>
      </main>
    </div>
  );
}

/** The viewer's own profile row. Memoized for the request so the cover, name,
 *  avatar, identity block and stat cards share a single read. */
const loadProfile = cache(async () => {
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip; RLS is authoritative.
  const me = (await getAuthUserId())!;
  const { data } = await supabase
    .from("profiles")
    .select(
      // `level`/`xp` are deliberately absent: the only thing that read them was
      // the Stats tab's progress bar, and that lives on /profile/aura now.
      "full_name, username, department, degree, bio, avatar_url, gender, cover_url, aura_score, verified"
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
    <CoverFallback />
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
    <div className="mt-1 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="type-display truncate">{profile?.full_name ?? "—"}</h1>
        <p className="type-callout truncate text-fg-muted">{deptLabel}</p>
      </div>
      {/* Neutral. Editing your own profile is available, not the thing this
          screen wants you to do; the person is. */}
      <Link
        href="/profile/edit"
        className="pressable focus-ring flex shrink-0 items-center gap-1.5 rounded-[10px] bg-fill px-4 py-2 text-sm font-semibold text-fg"
      >
        <Pencil className="h-4 w-4" aria-hidden />
        Edit
      </Link>
    </div>
  );
}

/** The avatar's corner check — rendered only for verified accounts. */
async function VerifiedTick() {
  const { profile } = await loadProfile();
  return profile?.verified ? <ProfileVerifiedTick /> : null;
}

/** Bio sits BELOW the stat cards (UISpec V3 Screen 14), so it is its own slot
 *  rather than part of the identity block above them. */
async function Bio() {
  const { profile } = await loadProfile();
  if (!profile?.bio) return null;
  return <p className="type-callout mb-5 leading-relaxed text-fg">{profile.bio}</p>;
}

function IdentitySkeleton() {
  return (
    <div className="mt-1 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-1.5 h-4 w-28" />
      </div>
      <Skeleton className="h-[42px] w-[86px] rounded-full" />
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
    <ProfileStats
      aura={profile?.aura_score ?? 0}
      matches={matchCount ?? 0}
      auraHref="/profile/aura"
      // The owner always reaches their own list, whatever show_matches says.
      matchesHref="/profile/matches"
      className="mb-5 mt-5"
    />
  );
}

function StatsSkeleton() {
  return (
    <div className="mb-5 mt-5 flex gap-3">
      <Skeleton className="h-[74px] flex-1 rounded-xl" />
      <Skeleton className="h-[74px] flex-1 rounded-xl" />
    </div>
  );
}

/** Your posts. Attributed posts only — an anonymous post is kept off every
 *  profile so this list can never reveal that this account authored one. */
async function Posts() {
  const supabase = await createClient();
  const { me } = await loadProfile();

  const { data: postRows } = await supabase
    .from("feed_posts")
    .select(FEED_COLUMNS)
    .eq("author_id", me)
    .eq("is_anonymous", false)
    .order("created_at", { ascending: false })
    .limit(30);

  const posts = (postRows as unknown as FeedPost[]) ?? [];

  return <ProfilePosts posts={posts} currentUserId={me} />;
}
