import { notFound, redirect } from "next/navigation";
import { ChatRoomShell, type ChatRoomShellTab } from "@/components/communities/chat-room-shell";
import { RoomChatTab } from "@/components/communities/tabs/room-chat-tab";
import { RoomMembersTab } from "@/components/communities/tabs/room-members-tab";
import type { CommunityMemberVM } from "@/components/communities/member-row";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { fetchPollResults, type PollOptionResult } from "@/app/(student)/communities/actions";
import type { CommunityMessage } from "@/components/communities/community-chat";

const ROLE_RANK: Record<CommunityMemberVM["role"], number> = {
  owner: 0,
  moderator: 1,
  member: 2,
};

/**
 * A casual chat room's page (is_society = false). Society/Event OS-registered
 * communities have their own richer shell at /societies/[id] — this page
 * redirects there so a society is never rendered as a plain room.
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

  const { data: membership } = await supabase
    .from("community_members")
    .select("role")
    .eq("community_id", id)
    .eq("user_id", me)
    .maybeSingle();

  const isMember = Boolean(membership);
  const isOwner = community.owner_id === me;
  const pending = community.status !== "approved";

  const [chatRows, memberRows] = await Promise.all([
    !pending && isMember
      ? supabase
          .from("community_chat_view")
          .select(
            "id, sender_id, sender_name, sender_avatar, body, poll_id, is_anonymous, created_at"
          )
          .eq("community_id", id)
          .order("created_at", { ascending: true })
          .limit(100)
      : Promise.resolve({ data: [] as CommunityMessage[] }),
    !pending
      ? supabase
          .from("community_members")
          .select("user_id, role, profile:profiles(id, full_name, username, avatar_url)")
          .eq("community_id", id)
          .limit(200)
      : Promise.resolve({ data: [] }),
  ]);

  const chatMessages = (chatRows.data as CommunityMessage[] | null) ?? [];
  const polls: Record<string, PollOptionResult[]> = await fetchPollResults(
    [...new Set(chatMessages.map((m) => m.poll_id).filter(Boolean) as string[])]
  );

  type Row = {
    user_id: string;
    role: CommunityMemberVM["role"];
    profile: { id: string; full_name: string | null; username: string | null; avatar_url: string | null } | null;
  };
  const members: CommunityMemberVM[] = ((memberRows.data ?? []) as unknown as Row[])
    .map((r) => ({
      user_id: r.user_id,
      role: r.role,
      full_name: r.profile?.full_name ?? null,
      username: r.profile?.username ?? null,
      avatar_url: r.profile?.avatar_url ?? null,
    }))
    .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);

  const tabs: ChatRoomShellTab[] = [
    {
      key: "chat",
      label: "Chat",
      content: (
        <RoomChatTab
          communityId={id}
          meId={me}
          isMember={isMember}
          initialMessages={chatMessages}
          initialPolls={polls}
        />
      ),
    },
    {
      key: "members",
      label: "Members",
      content: <RoomMembersTab description={community.description} members={members} />,
    },
  ];

  return (
    <ChatRoomShell
      community={{
        id: community.id,
        name: community.name,
        avatar_url: community.avatar_url,
        cover_url: community.cover_url,
        member_count: community.member_count,
      }}
      isMember={isMember}
      isOwner={isOwner}
      pending={pending}
      tabs={tabs}
    />
  );
}
