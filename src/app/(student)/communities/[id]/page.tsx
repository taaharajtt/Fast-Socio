import { Suspense } from "react";
import PageLoading from "./loading";
import { notFound, redirect } from "next/navigation";
import { ChatRoomShell, type ChatRoomShellTab } from "@/components/communities/chat-room-shell";
import { RoomOverviewTab } from "@/components/communities/tabs/room-overview-tab";
import { RoomManageTab } from "@/components/communities/tabs/room-manage-tab";
import { CommunityThread } from "@/components/chat/community-thread";
import { loadCommunityChat } from "@/lib/communities/chat-data";
import type { CommunityMemberVM } from "@/components/communities/member-row";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import {
  getCommunityRelationship,
  getJoinRequests,
} from "@/lib/communities/relationship";
import { getSocialProof } from "@/lib/communities/social-proof";
import { markCommunitySpaceSeen } from "@/lib/community/seen";

const ROLE_RANK: Record<CommunityMemberVM["role"], number> = {
  owner: 0,
  moderator: 1,
  member: 2,
};

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
export default function CommunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<PageLoading />}>
      <CommunityPageBody params={params} />
    </Suspense>
  );
}

/**
 * A chat room — Overview / Chat, plus Manage for the owner. Society/Event
 * OS-registered communities have their own richer shell at /societies/[id];
 * this page redirects there so a society is never rendered as a plain room.
 *
 * THE CONVERSATION LIVES HERE. It used to be a thread in the global Chat inbox
 * (/chat/c/[id]) next to direct messages; global Chat is person-to-person now,
 * and a room's chat is a tab on the room. It is the same conversation — same
 * `community_chat_messages` rows keyed on this community id, read through the
 * same `loadCommunityChat` loader and rendered by the same `CommunityThread` /
 * `CommunityChat` components the old route used.
 *
 * Members is not a tab: the roster is folded into Overview.
 *
 * Every tab's data is fetched here in parallel and handed to the client shell
 * as ready content, so switching tabs never touches the network.
 */
async function CommunityPageBody({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const me = (await getAuthUserId())!;

  const { data: community } = await supabase
    .from("communities")
    .select(
      "id, name, description, avatar_url, cover_url, member_count, status, owner_id, is_society, is_discover_group"
    )
    .eq("id", id)
    .single();
  if (!community) notFound();
  if (community.is_society) redirect(`/societies/${id}`);
  // A Discover team room has no community profile of its own — its whole
  // surface IS the conversation, which stays at /chat/c/[id]. Redirecting
  // (rather than 404ing) means one deep link, `/communities/<id>?tab=chat`,
  // resolves correctly for every kind of space.
  if (community.is_discover_group) redirect(`/chat/c/${id}`);

  // Stamped only once this is definitely the page being rendered — after the
  // society and Discover-room redirects above, so a redirect does not mark a
  // space the student never actually saw. Scoped to THIS space: reading one
  // room never silences another's badge items.
  markCommunitySpaceSeen(id);

  const pending = community.status !== "approved";
  // is_society is false here by construction (societies redirect above), so
  // canManage collapses to owner-or-admin — fix-031's owner-only Manage tab.
  const rel = await getCommunityRelationship(id, me, community.owner_id, false);
  // A chat room has exactly one owner and no moderator tier, so "manage" here
  // means "is the owner" (platform admins aside — canManage covers both).
  const canManage = rel.canManage;

  const { data: memberData } = !pending
    ? await supabase
        .from("community_members")
        .select(
          // Disambiguated FK: `community_members` gained a SECOND reference to
          // `profiles` in migration 0170 (`approved_by`), so a bare `profiles(...)`
          // embed is ambiguous and PostgREST rejects it with PGRST201 — which
          // surfaced as an empty roster. Name the FK we mean.
          "user_id, role, profile:profiles!community_members_user_id_fkey(id, full_name, username, avatar_url, gender)"
        )
        .eq("community_id", id)
        .limit(200)
    : { data: [] };

  const joinRequests = !pending && canManage ? await getJoinRequests(id) : [];

  // The room's thread, fetched up front like every other tab's content so
  // switching to Chat costs no round trip. Skipped for a non-member — and it
  // would return nothing for them anyway: community_chat_view is
  // SECURITY INVOKER and filters on a live community_members row, so read
  // access is revoked the moment membership is (leave / remove / ban).
  const chat = !pending && rel.isMember
    ? await loadCommunityChat(id, true)
    : { messages: [], polls: {}, reactions: {} };

  type Row = {
    user_id: string;
    role: CommunityMemberVM["role"];
    profile: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; gender: string | null } | null;
  };
  const members: CommunityMemberVM[] = ((memberData ?? []) as unknown as Row[])
    .map((r) => ({
      user_id: r.user_id,
      role: r.role,
      full_name: r.profile?.full_name ?? null,
      username: r.profile?.username ?? null,
      avatar_url: r.profile?.avatar_url ?? null,
      gender: r.profile?.gender ?? null,
    }))
    .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);

  // Cover social proof, ranked from the roster already loaded above.
  const proof = await getSocialProof(
    members.map((m) => m.user_id),
    community.member_count,
    me
  );

  const tabs: ChatRoomShellTab[] = [
    {
      key: "overview",
      label: "Overview",
      content: (
        <RoomOverviewTab
          description={community.description}
          memberCount={community.member_count}
          members={members}
        />
      ),
    },
  ];

  // Chat is members-only. A non-member still gets the TAB — it renders
  // CommunityThread's locked state (a line of copy and the join button, no
  // message previews) rather than vanishing, so the room reads the same to
  // everyone. The gate is presentation, not protection: the read view, the send
  // RPC, the poll RPCs, the attachment signer and realtime delivery each
  // re-check `community_members` server-side on every call, so leaving, being
  // removed or being banned revokes all five immediately.
  if (!pending) {
    tabs.push({
      key: "chat",
      label: "Chat",
      // Only the real thread needs the viewport locked; the locked state is a
      // short card and should sit on a normally scrolling page.
      fill: rel.isMember,
      content: (
        <CommunityThread
          communityId={id}
          meId={me}
          isMember={rel.isMember}
          joinStatus={rel.joinStatus}
          initialMessages={chat.messages}
          initialPolls={chat.polls}
          initialReactions={chat.reactions}
          canModerate={rel.canModerateChat}
        />
      ),
    });
  }

  if (canManage) {
    tabs.push({
      key: "manage",
      label: "Manage",
      badge: joinRequests.length,
      content: (
        <RoomManageTab
          communityId={id}
          name={community.name}
          isOwner={rel.isOwner}
          joinRequests={joinRequests}
          members={members}
        />
      ),
    });
  }

  return (
    <ChatRoomShell
      community={{
        id: community.id,
        name: community.name,
        avatar_url: community.avatar_url,
        cover_url: community.cover_url,
        member_count: community.member_count,
      }}
      proof={proof}
      isFollowing={rel.isFollowing}
      joinStatus={rel.joinStatus}
      isOwner={rel.isOwner}
      pending={pending}
      tabs={tabs}
    />
  );
}
