import { Suspense } from "react";
import PageLoading from "./loading";
import { SocietyShell, type SocietyShellTab } from "@/components/societies/society-shell";
import { BroadcastTab } from "@/components/societies/tabs/broadcast-tab";
import { EventsTab } from "@/components/societies/tabs/events-tab";
import { MembersTab } from "@/components/societies/tabs/members-tab";
import { ManageTab } from "@/components/societies/tabs/manage-tab";
import { getSocietyContext } from "@/lib/societies/load";
import { getJoinRequests } from "@/lib/communities/relationship";
import { getSocietyCapabilities } from "@/app/(student)/societies/actions";
import { getSocialProof } from "@/lib/communities/social-proof";
import {
  getSocietyOfficers,
  getUpcomingSocietyEvents,
  getPastSocietyEvents,
  getSocietyAnnouncementPage,
  getAnnouncementReactions,
} from "@/lib/societies/queries";
import { canManageSociety, canPostAnnouncement } from "@/lib/societies/logic";
import { createClient } from "@/lib/supabase/server";
import type { CommunityMemberVM } from "@/components/communities/member-row";
import type { PendingPost } from "@/components/communities/review-post-row";

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
export default function SocietyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<PageLoading />}>
      <SocietyPageBody params={params} />
    </Suspense>
  );
}

/**
 * A society's single page — Broadcast / Events / Members, plus Manage for
 * officers. Conversation does NOT live here at all: a verified community
 * broadcasts to its followers and has no chat surface — chat belongs to chat
 * rooms, inside the room. This
 * surface is for broadcasts, events, the roster and management.
 *
 * Every subtab's data is fetched here, up front, in parallel, and handed to the
 * client SocietyShell as fully-loaded content — so switching tabs is an instant
 * client state change with a frozen header, never a route navigation.
 */
async function SocietyPageBody({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getSocietyContext(id);
  const { viewer } = ctx;

  const canManage = canManageSociety(viewer);

  // UAT-04: the broadcast channel's capabilities come from the DATABASE
  // (`society_capabilities`, mig 0178) rather than from the client-side rank
  // mirror, because this is the surface whose rules changed — a plain member
  // may now post here, and only a president/owner/admin may reveal an anonymous
  // author. Mirroring that in TypeScript as well would give the UI a second
  // opinion that could drift from the one the RPCs enforce.
  const caps = await getSocietyCapabilities(id);
  const canPost = caps.can_post || canPostAnnouncement(viewer);

  const supabase = await createClient();

  const [officers, upcoming, past, announcementPage, memberRows, pendingRows] =
    await Promise.all([
      getSocietyOfficers(id),
      getUpcomingSocietyEvents(id, 40),
      getPastSocietyEvents(id, 20),
      // The newest ten; older ones arrive through the capsule's server action.
      getSocietyAnnouncementPage(id),
      supabase
        .from("community_members")
        .select(
          // See the note in /communities/[id]: migration 0170 added
          // community_members.approved_by -> profiles, so this embed must name
          // the FK it means or PostgREST returns PGRST201 and the list is empty.
          "user_id, profile:profiles!community_members_user_id_fkey(id, full_name, username, avatar_url, gender)"
        )
        .eq("community_id", id)
        .limit(200),
      canManage
        ? supabase
            .from("community_review_posts")
            .select("*")
            .eq("community_id", id)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as PendingPost[] }),
    ]);

  // Pending asks to participate — the Manage tab's access queue (mig 0119).
  // Reactions for the broadcasts on screen, so the channel paints its chips
  // with the messages rather than a round trip later.
  const [joinRequests, announcementReactions] = await Promise.all([
    canManage ? getJoinRequests(id) : Promise.resolve([]),
    getAnnouncementReactions(announcementPage.items.map((a) => a.id)),
  ]);

  const officerIds = new Set(officers.map((o) => o.user_id));
  type MemberRow = {
    user_id: string;
    profile: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; gender: string | null } | null;
  };
  const allMembers = (memberRows.data ?? []) as unknown as MemberRow[];
  // Officers are listed (and demoted) under their own heading, so the plain
  // roster excludes them on both the Members tab and the Manage kick list.
  const followers = allMembers
    .filter((r) => !officerIds.has(r.user_id))
    .map((r) => ({
      id: r.user_id,
      full_name: r.profile?.full_name ?? null,
      username: r.profile?.username ?? null,
      avatar_url: r.profile?.avatar_url ?? null,
      gender: r.profile?.gender ?? null,
    }));

  // remove_community_member() refuses to kick the owner or another manager, so
  // the removable set is exactly the non-officer roster.
  const removableMembers: CommunityMemberVM[] = followers.map((f) => ({
    user_id: f.id,
    full_name: f.full_name,
    username: f.username,
    avatar_url: f.avatar_url,
    gender: f.gender,
    role: "member",
  }));

  const pendingPosts = (pendingRows.data as PendingPost[] | null) ?? [];

  // Cover social proof, ranked from the roster we already loaded above.
  const proof = await getSocialProof(
    allMembers.map((r) => r.user_id),
    ctx.society.member_count,
    viewer.me
  );

  const tabs: SocietyShellTab[] = [
    {
      key: "broadcast",
      label: "Broadcast",
      content: (
        <BroadcastTab
          societyId={id}
          meId={viewer.me}
          announcements={announcementPage.items}
          reactions={announcementReactions}
          hasMoreHistory={announcementPage.hasMore}
          canPost={canPost}
          canManage={canManage}
          canPostAnonymously={caps.can_post_anonymously}
          canReveal={caps.can_reveal_anonymous}
        />
      ),
    },
    {
      key: "events",
      label: "Events",
      content: (
        <EventsTab societyId={id} upcoming={upcoming} past={past} canManage={canManage} />
      ),
    },
    {
      key: "members",
      label: "Members",
      content: (
        <MembersTab
          description={ctx.society.description}
          officers={officers}
          followers={followers}
        />
      ),
    },
  ];

  if (canManage) {
    tabs.push({
      key: "manage",
      label: "Manage",
      badge: pendingPosts.length + joinRequests.length,
      content: (
        <ManageTab
          society={ctx.society}
          pendingPosts={pendingPosts}
          joinRequests={joinRequests}
          officers={officers}
          members={removableMembers}
          viewer={{ role: viewer.role, isAdmin: viewer.isAdmin, me: viewer.me }}
        />
      ),
    });
  }

  return <SocietyShell ctx={ctx} proof={proof} tabs={tabs} />;
}
