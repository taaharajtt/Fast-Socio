import { Suspense } from "react";
import PageLoading from "./loading";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Check } from "lucide-react";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { RequestToChatButton } from "@/components/chat/request-to-chat";
import { ProfilePosts } from "@/components/profile/profile-posts";
import { ProfileActionsMenu } from "@/components/profile/profile-actions-menu";
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
import { OnlineDot } from "@/components/ui/badges";
import { deptMeta } from "@/lib/leaderboard/departments";
import { isOnline, presenceLabel } from "@/lib/time";
import { FEED_COLUMNS, type FeedPost } from "@/lib/feed/types";
import { semesterLabel } from "@/lib/profile/constants";
import { deriveSemester } from "@/lib/profile/semester";
import { matchesHref } from "@/lib/profile/matches-visibility";

/**
 * PERF/CORRECTNESS (perf audit Phase 4) — this default export is deliberately
 * NOT async and never awaits `params`/`searchParams`. Under Cache Components,
 * reading request data (or calling `notFound()`) at the top level makes the
 * route dynamic while Next is still building its fallback shell; resuming that
 * shell then throws
 *
 *   InvariantError: postponed state should not be provided when fallback
 *   params are provided        (E592)
 *
 * which surfaces as a 500. The request-scoped work lives in the async body
 * below, behind a Suspense boundary. Same shape as /post/[id], which hit this
 * exact bug first and documents it.
 */
export default function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PublicProfilePageBody params={params} />
    </Suspense>
  );
}

async function PublicProfilePageBody({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip (layout already
  // gated this route; RLS scopes every query below).
  const me = (await getAuthUserId())!;
  const isSelf = id === me;

  const [{ data: profile }, { data: presence }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        // `disable_message_requests` (mig 0196) is the ONLY thing added here,
        // and it decides one thing: whether the first-contact button renders.
        "id, full_name, username, department, degree, bio, avatar_url, gender, cover_url, aura_score, verified, show_online, show_aura, show_department, show_semester, show_matches, disable_message_requests, deactivated_at"
      )
      .eq("id", id)
      .single(),
    // Presence moved to profile_presence (mig 0092), where an RLS policy — not
    // this page — decides whether you may see it. A user with show_online off
    // simply returns no row, so last_seen_at is null and reads as offline.
    supabase
      .from("profile_presence")
      .select("last_seen_at")
      .eq("id", id)
      .maybeSingle(),
  ]);
  if (!profile) notFound();

  const lastSeenAt = presence?.last_seen_at ?? null;

  // Privacy gating (Refactor Phase 8): a viewer never sees hidden fields; the
  // owner always sees their own. Columns are absent until mig 0058 → default to
  // visible so nothing regresses pre-migration.
  const showOnline = isSelf || profile.show_online !== false;
  const showAura = isSelf || profile.show_aura !== false;
  const showDept = isSelf || profile.show_department !== false;
  const showSem = isSelf || profile.show_semester !== false;
  const deactivated = !isSelf && Boolean(profile.deactivated_at);

  /**
   * Does this person still take first-contact requests? (mig 0196)
   *
   * `!== true` rather than `=== false`, so a row read before the column existed
   * — or one whose select was narrowed by a future edit — falls back to the
   * OPEN state and simply shows the button. The database is what actually
   * refuses the send, so failing open here costs a friendly error at worst,
   * while failing closed would silently hide first contact for everyone the
   * moment this column stopped being selected.
   */
  const acceptsRequests = profile.disable_message_requests !== true;

  // Are we matched? Only then do we surface a Message action.
  let matched = false;
  let iBlocked = false;
  let iMuted = false;
  if (!isSelf) {
    const [lo, hi] = [me, id].sort();
    const [{ data: match }, { data: block }, { data: mute }] = await Promise.all([
      supabase
        .from("matches")
        .select("id")
        .eq("user_low", lo)
        .eq("user_high", hi)
        .maybeSingle(),
      supabase
        .from("blocked_users")
        .select("blocked_id")
        .eq("blocker_id", me)
        .eq("blocked_id", id)
        .maybeSingle(),
      supabase
        .from("muted_users")
        .select("muted_id")
        .eq("muter_id", me)
        .eq("muted_id", id)
        .maybeSingle(),
    ]);
    matched = Boolean(match);
    iBlocked = Boolean(block);
    iMuted = Boolean(mute);
  }

  // Deactivated accounts show a minimal placeholder to others (data preserved).
  if (deactivated) {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-5 text-center">
        <Link
          href="/home"
          aria-label="Back"
          className="glass absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <p className="text-lg font-semibold text-fg">Account unavailable</p>
        <p className="mt-1 text-sm text-fg-muted">
          This account is currently deactivated.
        </p>
      </main>
    );
  }

  const [{ data: postRows }, { data: matchCount }, badges] = await Promise.all([
    // Anonymous posts must NEVER appear on a profile — listing them here would
    // attribute the post to this account and defeat anonymity (the feed_posts
    // view only masks the author for non-admins, so filtering on the surface is
    // the real guard). A profile's Posts tab shows attributed posts only.
    supabase
      .from("feed_posts")
      .select(FEED_COLUMNS)
      .eq("author_id", id)
      .eq("is_anonymous", false)
      .order("created_at", { ascending: false })
      .limit(30),
    // A plain count query here is RLS-scoped to the VIEWER, not `id` — it can
    // only see rows where the viewer is also a participant, so it silently
    // collapses to 0 or 1 (the viewer's own match with this person, if any)
    // instead of this person's real total. get_match_count is a SECURITY
    // DEFINER RPC that returns just the aggregate count, bypassing that.
    supabase.rpc("get_match_count", { p_user_id: id }),
    getEarnedBadges(supabase, id),
  ]);

  const posts = (postRows as FeedPost[]) ?? [];

  const initials =
    (profile.full_name ?? "")
      .trim()
      .split(/\s+/)
      .map((w: string) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  const semester = deriveSemester(profile.username);
  const deptLabel =
    showDept && profile.department
      ? [
          deptMeta(profile.department).abbr,
          profile.degree,
          showSem && semester ? semesterLabel(semester) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "—";

  return (
    <div className="mx-auto w-full max-w-md -mt-[var(--safe-top)]">
      {/* Cover banner (200px) + overlapping 80px avatar (UISpec V3 Screen 14).
          UAT-001: a profile's own cover was rendered but never anyone else's —
          this page simply didn't read cover_url. RLS always allowed it.
          This hero is intentionally full-bleed and bleeds under the status
          bar, so the container above cancels the shell's top safe-area inset;
          the floating Back control pays that inset back itself. */}
      <div className="relative h-[200px]">
        {profile.cover_url ? (
          <AppImage
            src={profile.cover_url}
            alt=""
            sizes="(max-width: 448px) 100vw, 448px"
            priority
          />
        ) : (
          <CoverFallback />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/20 to-transparent" />
        {/* Floating over a photo, so it carries its own material to stay
            legible whatever the cover happens to be (apple.md §12). */}
        <Link
          href="/home"
          aria-label="Back"
          className="material-bar pressable focus-ring absolute left-4 top-[max(1rem,calc(var(--safe-top)+0.5rem))] flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="absolute -bottom-10 left-4">
          <div className="relative h-20 w-20 rounded-full">
            <div className="relative h-full w-full overflow-hidden rounded-full border-[3px] border-bg bg-card">
              {resolveAvatarUrl(profile.avatar_url, profile.gender) ? (
                <AppImage
                  src={resolveAvatarUrl(profile.avatar_url, profile.gender)!}
                  alt={profile.full_name ?? "Avatar"}
                  sizes="80px"
                  priority
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xl font-bold">
                  {initials}
                </span>
              )}
            </div>
            {showOnline && isOnline(lastSeenAt) && (
              <OnlineDot className="bottom-1 right-1 h-3.5 w-3.5" />
            )}
            {profile.verified && <ProfileVerifiedTick />}
          </div>
        </div>
      </div>

      <main className="px-4 pb-6">
        {/* Earned badges sit in the band right of the avatar (per design) and
            double as the spacer that clears the avatar overhang. */}
        <BadgeStrip badges={badges} />

        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="type-display truncate">
              {profile.full_name ?? "Student"}
            </h1>
            <p className="type-callout truncate text-fg-muted">{deptLabel}</p>
            {showOnline && (
              <p className="type-caption truncate text-fg-disabled">
                {presenceLabel(lastSeenAt)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isSelf ? (
              <Link
                href="/profile/edit"
                className="pressable focus-ring flex shrink-0 items-center gap-1.5 rounded-[10px] bg-fill px-4 py-2 text-sm font-semibold text-fg"
              >
                Edit
              </Link>
            ) : matched ? (
              <OpenChatButton otherId={profile.id} />
            ) : iBlocked ? (
              // A blocked pair creates no new interactions in either direction
              // (UAT-05), so no first-contact affordance is offered at all.
              <span className="flex items-center gap-1.5 rounded-full bg-fill px-4 py-2.5 text-sm font-medium text-fg-muted">
                <Check className="h-4 w-4" aria-hidden />
                Blocked
              </span>
            ) : acceptsRequests ? (
              // UAT-01, path 2. This used to read "Match to chat" — an inert
              // caption naming a requirement that was never actually the rule:
              // message_requests has been the first-contact path since mig 0004
              // and needs no match. The profile simply never offered it.
              <RequestToChatButton
                recipientId={profile.id}
                name={profile.full_name}
              />
            ) : null}
            {!isSelf && (
              <ProfileActionsMenu
                targetId={profile.id}
                blocked={iBlocked}
                muted={iMuted}
              />
            )}
          </div>
        </div>

        {/* The Matches stat leads onward only for a CURRENT match of someone
            who has not hidden their list (mig 0182). `matched` is the
            authoritative read from `matches` above — never inferred from a
            chat, a request or a like. The link is only the affordance:
            get_matches_of() re-checks all of it and returns nothing to anyone
            who types the URL. */}
        <ProfileStats
          aura={profile.aura_score ?? 0}
          matches={matchCount ?? 0}
          showAura={showAura}
          matchesHref={matchesHref({
            profileId: profile.id,
            isSelf,
            matched,
            showMatches: profile.show_matches,
          })}
          className="mb-5 mt-5"
        />

        {profile.bio && (
          <p className="type-callout mb-5 leading-relaxed text-fg">{profile.bio}</p>
        )}

        {/* Posts-only, and now so is your own profile — there is no tab model
            left on either screen. Nothing reads `?tab=`, so a stray
            ?tab=help / ?tab=stats / ?tab=communities from an old link is simply
            ignored and this posts list renders. */}
        <ProfilePosts posts={posts} currentUserId={me} />
      </main>
    </div>
  );
}
