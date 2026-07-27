import { notFound, redirect } from "next/navigation";
import { ChatRoomShell, type ChatRoomShellTab } from "@/components/communities/chat-room-shell";
import { RoomOverviewTab } from "@/components/communities/tabs/room-overview-tab";
import { RoomMembersTab } from "@/components/communities/tabs/room-members-tab";
import { RoomManageTab } from "@/components/communities/tabs/room-manage-tab";
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
 * A casual chat room's PROFILE page (is_society = false) — Overview / Members,
 * plus Manage for the owner. Society/Event OS-registered communities have their
 * own richer shell at /societies/[id] — this page redirects there so a society
 * is never rendered as a plain room.
 *
 * The conversation is not here. Room chats are threads in the Chat area
 * (/chat/c/[id]) beside direct messages; Overview links across to them.
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
      "id, name, description, avatar_url, cover_url, member_count, status, owner_id, is_society"
    )
    .eq("id", id)
    .single();
  if (!community) notFound();
  if (community.is_society) redirect(`/societies/${id}`);

  const pending = community.status !== "approved";
  const rel = await getCommunityRelationship(id, me, community.owner_id);
  // A chat room has exactly one owner and no moderator tier, so "manage" here
  // means "is the owner" (platform admins aside — canManage covers both).
  const canManage = rel.canManage;

  const { data: memberData } = !pending
    ? await supabase
        .from("community_members")
        .select("user_id, role, profile:profiles(id, full_name, username, avatar_url)")
        .eq("community_id", id)
        .limit(200)
    : { data: [] };

  const joinRequests = !pending && canManage ? await getJoinRequests(id) : [];

  type Row = {
    user_id: string;
    role: CommunityMemberVM["role"];
    profile: { id: string; full_name: string | null; username: string | null; avatar_url: string | null } | null;
  };
  const members: CommunityMemberVM[] = ((memberData ?? []) as unknown as Row[])
    .map((r) => ({
      user_id: r.user_id,
      role: r.role,
      full_name: r.profile?.full_name ?? null,
      username: r.profile?.username ?? null,
      avatar_url: r.profile?.avatar_url ?? null,
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
          communityId={id}
          description={community.description}
          memberCount={community.member_count}
          isMember={rel.isMember}
          joinStatus={rel.joinStatus}
        />
      ),
    },
    {
      key: "members",
      label: "Members",
      content: <RoomMembersTab members={members} />,
    },
  ];

  if (canManage) {
    tabs.push({
      key: "manage",
      label: "Manage",
      badge: joinRequests.length,
      content: (
        <RoomManageTab
          communityId={id}
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
