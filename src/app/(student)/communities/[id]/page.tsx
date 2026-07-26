import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { communityIcon } from "@/lib/communities/icon";
import { JoinButton } from "@/components/communities/join-button";
import { PostComposer } from "@/components/feed/post-composer";
import { PostCard } from "@/components/feed/post-card";
import { ReviewPostRow, type PendingPost } from "@/components/communities/review-post-row";
import { RegisterSocietyButton } from "@/components/societies/register-society-button";
import { MemberRow, type CommunityMemberVM } from "@/components/communities/member-row";
import { EventMini } from "@/components/societies/event-mini";
import { RouteTabs, type RouteTab } from "@/components/ui/route-tabs";
import { SkeletonCards, SkeletonRows } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import type { FeedPost } from "@/lib/feed/types";
import type { SocietyEvent } from "@/lib/societies/queries";

type CommunityTab = "overview" | "announcements" | "members";

const ROLE_RANK: Record<CommunityMemberVM["role"], number> = {
  owner: 0,
  moderator: 1,
  member: 2,
};

/**
 * A plain community's page (Society/Event OS-registered communities also link
 * out to their own richer /societies/[id] shell — see the entry point below).
 *
 * Role & permission model: Owner > Moderator > Member.
 *   - Members: read-only Overview, Announcements, and Members.
 *   - Moderators: same three tabs, plus inline Approve/Reject on pending
 *     announcements (Zone 1 moderation — the community_review_posts queue).
 *   - Owners: everything moderators have, plus the Manage/Edit header button
 *     (owner-only server-side too — see the edit route) and a "Create event"
 *     entry point. Both moderateCommunityPost and updateCommunity are also
 *     enforced at the RPC/RLS layer, so these UI gates are a courtesy, not the
 *     only guard.
 */
export default async function CommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const { data: community } = await supabase
    .from("communities")
    .select("id, name, description, avatar_url, cover_url, member_count, status, owner_id, is_society")
    .eq("id", id)
    .single();
  if (!community) notFound();

  const { data: membership } = await supabase
    .from("community_members")
    .select("role")
    .eq("community_id", id)
    .eq("user_id", me)
    .maybeSingle();

  const isMember = Boolean(membership);
  const role = membership?.role ?? null;
  const isOwner = community.owner_id === me;
  const isMod = role === "owner" || role === "moderator";
  const pending = community.status !== "approved";

  const active: CommunityTab =
    tab === "announcements" ? "announcements" : tab === "members" ? "members" : "overview";

  // Load only what the active tab needs.
  let upcomingEvents: SocietyEvent[] = [];
  let posts: FeedPost[] = [];
  let pendingPosts: PendingPost[] = [];
  let pendingCount = 0;
  let members: CommunityMemberVM[] = [];

  if (isMod) {
    const { count } = await supabase
      .from("community_review_posts")
      .select("id", { count: "exact", head: true })
      .eq("community_id", id);
    pendingCount = count ?? 0;
  }

  if (!pending && active === "overview") {
    const { data: eventRows } = await supabase
      .from("events")
      .select("id, title, starts_at, location, cover_url, attendee_count, capacity, status")
      .eq("community_id", id)
      .eq("status", "approved")
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(5);
    upcomingEvents = (eventRows as SocietyEvent[]) ?? [];
  } else if (!pending && active === "announcements") {
    const { data: postRows } = await supabase
      .from("feed_posts")
      .select("*")
      .eq("community_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    posts = (postRows as FeedPost[]) ?? [];

    if (isMod) {
      const { data: rows } = await supabase
        .from("community_review_posts")
        .select("*")
        .eq("community_id", id)
        .order("created_at", { ascending: true });
      pendingPosts = (rows as PendingPost[]) ?? [];
    }
  } else if (!pending && active === "members") {
    const { data: memberRows } = await supabase
      .from("community_members")
      .select("user_id, role, profile:profiles(id, full_name, username, avatar_url)")
      .eq("community_id", id)
      .limit(200);
    type Row = {
      user_id: string;
      role: CommunityMemberVM["role"];
      profile: { id: string; full_name: string | null; username: string | null; avatar_url: string | null } | null;
    };
    members = ((memberRows ?? []) as unknown as Row[])
      .map((r) => ({
        user_id: r.user_id,
        role: r.role,
        full_name: r.profile?.full_name ?? null,
        username: r.profile?.username ?? null,
        avatar_url: r.profile?.avatar_url ?? null,
      }))
      .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
  }

  const tabHref = (t: CommunityTab) =>
    t === "overview" ? `/communities/${id}` : `/communities/${id}?tab=${t}`;

  const tabs: RouteTab[] = [
    { key: "overview", href: tabHref("overview"), label: "Overview" },
    {
      key: "announcements",
      href: tabHref("announcements"),
      label: "Announcements",
      badge: isMod ? pendingCount : 0,
    },
    { key: "members", href: tabHref("members"), label: "Members" },
  ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col">
      {/* Banner hero (UISpec V3 Screen 12): 200px cover, back arrow, and the
          community identity + Join button overlaid on a bottom gradient. */}
      <div className="relative h-[200px] w-full overflow-hidden">
        {community.cover_url || community.avatar_url ? (
          <AppImage
            src={community.cover_url ?? community.avatar_url}
            alt=""
            sizes="(max-width: 448px) 100vw, 448px"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{ background: "linear-gradient(135deg, #4c1d95, #7c3aed)" }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <Link
          href="/events"
          aria-label="Back"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        {/* Manage/Edit is owner-only — moderators get the inline Approve/Reject
            controls on Announcements instead, never full metadata control. */}
        {isOwner && (
          <Link
            href={`/communities/${community.id}/edit`}
            aria-label="Edit community"
            className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Link>
        )}
        <div className="absolute inset-x-4 bottom-3 flex items-end gap-3">
          <span className="text-3xl leading-none" aria-hidden>
            {communityIcon(community.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[17px] font-bold text-white">
                {community.name}
              </h1>
              {pending && <GlassChip tone="warning">pending</GlassChip>}
            </div>
            <p className="text-[13px] text-white/70">
              {community.member_count.toLocaleString()} member
              {community.member_count === 1 ? "" : "s"}
            </p>
          </div>
          {!pending && (
            <JoinButton
              communityId={community.id}
              isMember={isMember}
              isOwner={isOwner}
            />
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-4 py-4">
        {pending ? (
          <p className="mt-2 text-center text-sm text-fg-muted">
            This community is awaiting admin approval.
          </p>
        ) : (
          <RouteTabs
            tabs={tabs}
            activeKey={active}
            variant="underline"
            // UAT-006: the pill lights on tap and the panel shimmers until the
            // next tab's server render lands.
            skeletons={{
              overview: <SkeletonRows count={3} />,
              announcements: <SkeletonCards />,
              members: <SkeletonRows count={4} />,
            }}
          >
            {active === "overview" && (
              <div className="mt-4 space-y-4">
                {community.description && (
                  <p className="text-[15px] text-fg-muted">
                    {community.description}
                  </p>
                )}

                {/* Society/Event OS entry point: an approved community can
                    become a society (public page + officer roles + announcements
                    + events). Owner-only when not yet registered. */}
                {community.is_society ? (
                  <Link
                    href={`/societies/${community.id}`}
                    className="flex items-center gap-3 rounded-[var(--radius-md)] bg-card px-4 py-3"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                      <ChevronRight className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fg">
                        Society page
                      </span>
                      <span className="block text-xs text-fg-muted">
                        Public profile, officers, announcements & events
                      </span>
                    </span>
                  </Link>
                ) : (
                  isOwner && <RegisterSocietyButton communityId={community.id} />
                )}

                {isMember && (
                  <Link
                    href={`/communities/${community.id}/chat`}
                    className="flex items-center gap-3 rounded-[var(--radius-md)] bg-card px-4 py-3"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                      <MessageCircle className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fg">
                        Community chat room
                      </span>
                      <span className="block text-xs text-fg-muted">
                        Chat live with members — opens in Messages
                      </span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
                  </Link>
                )}

                {/* Member stats. */}
                <Link
                  href={tabHref("members")}
                  className="flex items-center gap-3 rounded-[var(--radius-md)] bg-card px-4 py-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <Users className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg">
                      {community.member_count.toLocaleString()} member
                      {community.member_count === 1 ? "" : "s"}
                    </span>
                    <span className="block text-xs text-fg-muted">
                      See who&apos;s in this community
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
                </Link>

                {/* Upcoming events hosted by this community. Only owners and
                    moderators can host an event under this community — enforced
                    by the "students submit pending events" RLS policy, which
                    requires community_id's caller to be an owner/moderator. */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                      <CalendarDays className="h-4 w-4" aria-hidden /> Upcoming events
                    </h2>
                    {isMod && (
                      <Link
                        href={`/events/new?communityId=${community.id}`}
                        className="flex items-center gap-1 text-xs font-medium text-accent"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden /> Create
                      </Link>
                    )}
                  </div>
                  {upcomingEvents.length === 0 ? (
                    <p className="rounded-[14px] bg-card px-4 py-6 text-center text-sm text-fg-muted">
                      No upcoming events.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {upcomingEvents.map((e) => (
                        <EventMini key={e.id} event={e} />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {active === "announcements" && (
              <div className="mt-4 space-y-4">
                {/* Pending submissions, inline above the main feed — moderator
                    (and owner) only. Approve/Reject call moderateCommunityPost,
                    which the moderate_community_post RPC re-checks server-side. */}
                {isMod && pendingPosts.length > 0 && (
                  <section className="space-y-3">
                    <p className="text-sm font-medium text-fg-muted">
                      Awaiting your review
                    </p>
                    {pendingPosts.map((p) => (
                      <ReviewPostRow key={p.id} post={p} />
                    ))}
                  </section>
                )}

                {isMember && (
                  <PostComposer
                    communityId={community.id}
                    placeholder={`Post to ${community.name}…`}
                    reviewNotice={
                      isMod
                        ? undefined
                        : "Post submitted for review. It appears once a moderator approves it."
                    }
                  />
                )}
                <div className="space-y-4">
                  {posts.length === 0 ? (
                    <p className="py-8 text-center text-sm text-fg-muted">
                      {isMember
                        ? "No approved announcements yet — start the conversation."
                        : "Join to see and share announcements."}
                    </p>
                  ) : (
                    posts.map((p) => <PostCard key={p.id} post={p} />)
                  )}
                </div>
              </div>
            )}

            {active === "members" && (
              <div className="mt-4">
                {members.length === 0 ? (
                  <GlassCard className="p-5">
                    <p className="text-sm text-fg-muted">No members yet.</p>
                  </GlassCard>
                ) : (
                  <div className="space-y-2">
                    {members.map((m) => (
                      <MemberRow key={m.user_id} member={m} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </RouteTabs>
        )}
      </div>
    </main>
  );
}
