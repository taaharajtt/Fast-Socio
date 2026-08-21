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

const ROLE_RANK: Record<CommunityMemberVM["role"], number> = {
  owner: 0,
  moderator: 1,
  member: 2,
};

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
export default async function CommunityPage({
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
        .select("user_id, role, profile:profiles(id, full_name, username, avatar_url, gender)")
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
    : { messages: [], polls: {} };

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
