import { SocietyShell, type SocietyShellTab } from "@/components/societies/society-shell";
import { BroadcastTab } from "@/components/societies/tabs/broadcast-tab";
import { SpaceChatTab } from "@/components/communities/tabs/space-chat-tab";
import { EventsTab } from "@/components/societies/tabs/events-tab";
import { MembersTab } from "@/components/societies/tabs/members-tab";
import { ManageTab } from "@/components/societies/tabs/manage-tab";
import { getSocietyContext } from "@/lib/societies/load";
import { getJoinRequests } from "@/lib/communities/relationship";
import { getSocialProof } from "@/lib/communities/social-proof";
import {
  getSocietyOfficers,
  getUpcomingSocietyEvents,
  getPastSocietyEvents,
  getSocietyAnnouncements,
} from "@/lib/societies/queries";
import { canManageSociety, canPostAnnouncement } from "@/lib/societies/logic";
import { createClient } from "@/lib/supabase/server";
import { fetchPollResults, type PollOptionResult } from "@/app/(student)/communities/actions";
import type { CommunityMessage } from "@/components/communities/community-chat";
import type { PendingPost } from "@/components/communities/review-post-row";

/**
 * A society's single page. Every subtab's data is fetched here, up front, in
 * parallel, and handed to the client SocietyShell as fully-loaded content —
 * so switching tabs (Broadcast/Chat/Events/Members/Manage) is an instant
 * client state change with a frozen header, never a route navigation.
 */
export default async function SocietyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getSocietyContext(id);
  const { viewer } = ctx;
  const canManage = canManageSociety(viewer);
  const canPost = canPostAnnouncement(viewer);
  // Chat is for JOINED members only; followers spectate the broadcast feed.
  const isMember = viewer.isMember;

  const supabase = await createClient();

  const [
    officers,
    upcoming,
    past,
    announcements,
    chatRows,
    followerRows,
    pendingRows,
  ] = await Promise.all([
    getSocietyOfficers(id),
    getUpcomingSocietyEvents(id, 40),
    getPastSocietyEvents(id, 20),
    getSocietyAnnouncements(id, 50),
    isMember
      ? supabase
          .from("community_chat_view")
          .select(
            "id, sender_id, sender_name, sender_avatar, body, poll_id, is_anonymous, created_at"
          )
          .eq("community_id", id)
          .order("created_at", { ascending: true })
          .limit(100)
      : Promise.resolve({ data: [] as CommunityMessage[] }),
    supabase
      .from("community_members")
      .select("user_id, profile:profiles(id, full_name, username, avatar_url)")
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
  const joinRequests = canManage ? await getJoinRequests(id) : [];

  const chatMessages = (chatRows.data as CommunityMessage[] | null) ?? [];
  const polls: Record<string, PollOptionResult[]> = await fetchPollResults(
    [...new Set(chatMessages.map((m) => m.poll_id).filter(Boolean) as string[])]
  );

  const officerIds = new Set(officers.map((o) => o.user_id));
  type MemberRow = {
    user_id: string;
    profile: { id: string; full_name: string | null; username: string | null; avatar_url: string | null } | null;
  };
  const followers = ((followerRows.data ?? []) as unknown as MemberRow[])
    .filter((r) => !officerIds.has(r.user_id))
    .map((r) => ({
      id: r.user_id,
      full_name: r.profile?.full_name ?? null,
      username: r.profile?.username ?? null,
      avatar_url: r.profile?.avatar_url ?? null,
    }));

  const pendingPosts = (pendingRows.data as PendingPost[] | null) ?? [];

  // Cover social proof, ranked from the roster we already loaded above.
  const proof = await getSocialProof(
    ((followerRows.data ?? []) as unknown as MemberRow[]).map((r) => r.user_id),
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
          announcements={announcements}
          canPost={canPost}
          canManage={canManage}
        />
      ),
    },
    {
      key: "chat",
      label: "Chat",
      // Owns the viewport below the tab bar so the composer can sit on the
      // bottom edge and only the message feed scrolls.
      fill: true,
      content: (
        <SpaceChatTab
          communityId={id}
          meId={viewer.me}
          isMember={isMember}
          joinStatus={viewer.joinStatus}
          initialMessages={chatMessages}
          initialPolls={polls}
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
          viewer={{ role: viewer.role, isAdmin: viewer.isAdmin }}
        />
      ),
    });
  }

  return <SocietyShell ctx={ctx} proof={proof} tabs={tabs} />;
}
