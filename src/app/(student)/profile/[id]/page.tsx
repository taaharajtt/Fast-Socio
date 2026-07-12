import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Zap, Heart, Check } from "lucide-react";
import { OpenChatButton } from "@/components/chat/open-chat-button";
import { ProfileTabs, type ProfileCommunity } from "@/components/profile/profile-tabs";
import { ProfileActionsMenu } from "@/components/profile/profile-actions-menu";
import { createClient } from "@/lib/supabase/server";
import { AppImage } from "@/components/ui/app-image";
import { OnlineDot } from "@/components/ui/badges";
import { deptMeta } from "@/lib/leaderboard/departments";
import { isOnline, presenceLabel } from "@/lib/time";
import type { FeedPost } from "@/lib/feed/types";

/** 1 → "1st", 6 → "6th" (UISpec V3 "6th Semester"). */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;
  const isSelf = id === me;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, full_name, department, semester, bio, avatar_url, cover_url, aura_score, verified, last_seen_at, show_online, show_aura, show_department, show_semester, deactivated_at"
    )
    .eq("id", id)
    .single();
  if (!profile) notFound();

  // Privacy gating (Refactor Phase 8): a viewer never sees hidden fields; the
  // owner always sees their own. Columns are absent until mig 0058 → default to
  // visible so nothing regresses pre-migration.
  const showOnline = isSelf || profile.show_online !== false;
  const showAura = isSelf || profile.show_aura !== false;
  const showDept = isSelf || profile.show_department !== false;
  const showSem = isSelf || profile.show_semester !== false;
  const deactivated = !isSelf && Boolean(profile.deactivated_at);

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

  const [{ data: postRows }, { count: matchCount }, { data: commRows }] =
    await Promise.all([
      // Anonymous posts must NEVER appear on a profile — listing them here would
      // attribute the post to this account and defeat anonymity (the feed_posts
      // view only masks the author for non-admins, so filtering on the surface is
      // the real guard). A profile's Posts tab shows attributed posts only.
      supabase
        .from("feed_posts")
        .select("*")
        .eq("author_id", id)
        .eq("is_anonymous", false)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("matches")
        .select("id", { count: "exact", head: true })
        .or(`user_low.eq.${id},user_high.eq.${id}`),
      supabase
        .from("community_members")
        .select("community:communities(id, name, member_count, status)")
        .eq("user_id", id),
    ]);

  const posts = (postRows as FeedPost[]) ?? [];
  const communities = ((commRows ?? [])
    .map((r) => r.community as unknown as (ProfileCommunity & { status: string }) | null)
    .filter((c): c is ProfileCommunity & { status: string } =>
      Boolean(c) && c!.status === "approved"
    )) as ProfileCommunity[];

  const initials =
    (profile.full_name ?? "")
      .trim()
      .split(/\s+/)
      .map((w: string) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  const deptLabel =
    showDept && profile.department
      ? deptMeta(profile.department).abbr +
        (showSem && profile.semester
          ? ` · ${ordinal(profile.semester)} Semester`
          : "")
      : "—";

  return (
    <div className="mx-auto w-full max-w-md">
      {/* Cover banner (200px) + overlapping 80px avatar (UISpec V3 Screen 14).
          UAT-001: a profile's own cover was rendered but never anyone else's —
          this page simply didn't read cover_url. RLS always allowed it. */}
      <div className="relative h-[200px]">
        {profile.cover_url ? (
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
          href="/home"
          aria-label="Back"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        {profile.full_name && (
          <span className="absolute bottom-3 left-[108px] text-[13px] font-semibold text-white/70">
            {profile.full_name}
          </span>
        )}
        <div className="absolute -bottom-10 left-4">
          <div className="relative h-20 w-20 rounded-full">
            <div className="relative h-full w-full overflow-hidden rounded-full border-[3px] border-bg bg-card">
              {profile.avatar_url ? (
                <AppImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? "Avatar"}
                  sizes="80px"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xl font-bold">
                  {initials}
                </span>
              )}
            </div>
            {showOnline && isOnline(profile.last_seen_at) && (
              <OnlineDot className="bottom-1 right-1 h-3.5 w-3.5" />
            )}
          </div>
        </div>
      </div>

      <main className="px-4 pb-28">
        {profile.verified && (
          <span
            aria-label="Verified"
            className="mt-12 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white"
          >
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
          </span>
        )}
        <div
          className={`flex items-start justify-between gap-3 ${profile.verified ? "mt-1" : "mt-12"}`}
        >
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-bold tracking-tight">
              {profile.full_name ?? "Student"}
            </h1>
            <p className="truncate text-sm text-fg-muted">{deptLabel}</p>
            {showOnline && (
              <p className="truncate text-xs text-fg-disabled">
                {presenceLabel(profile.last_seen_at)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isSelf ? (
              <Link
                href="/profile/edit"
                className="gradient-brand flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white"
              >
                Edit
              </Link>
            ) : matched ? (
              <OpenChatButton otherId={profile.id} />
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-card px-4 py-2 text-sm font-medium text-fg-muted">
                <Check className="h-4 w-4" aria-hidden />
                Match to chat
              </span>
            )}
            {!isSelf && (
              <ProfileActionsMenu
                targetId={profile.id}
                blocked={iBlocked}
                muted={iMuted}
              />
            )}
          </div>
        </div>

        <div className="mb-5 mt-4 flex gap-3">
          {showAura && (
            <div className="flex-1 rounded-xl bg-card p-3 text-center">
              <div className="flex items-center justify-center gap-1.5">
                <Zap className="h-4 w-4 text-gold" aria-hidden />
                <p className="text-xl font-bold">{profile.aura_score ?? 0}</p>
              </div>
              <p className="mt-1 text-xs text-fg-muted">Aura</p>
            </div>
          )}
          <div className="flex-1 rounded-xl bg-card p-3 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Heart className="h-4 w-4 fill-error text-error" aria-hidden />
              <p className="text-xl font-bold">{matchCount ?? 0}</p>
            </div>
            <p className="mt-1 text-xs text-fg-muted">Matches</p>
          </div>
        </div>

        {profile.bio && (
          <p className="mb-5 text-sm leading-relaxed text-fg">{profile.bio}</p>
        )}

        <ProfileTabs posts={posts} communities={communities} currentUserId={me} />
      </main>
    </div>
  );
}
