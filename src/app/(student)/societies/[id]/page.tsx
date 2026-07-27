import { SocietyShell, type SocietyShellTab } from "@/components/societies/society-shell";
import { BroadcastTab } from "@/components/societies/tabs/broadcast-tab";
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
import type { CommunityMemberVM } from "@/components/communities/member-row";
import type { PendingPost } from "@/components/communities/review-post-row";

/**
 * A society's single page — Broadcast / Events / Members, plus Manage for
 * officers. Conversation deliberately does NOT live here: the general chat is a
 * thread in the Chat area (/chat/c/[id]) alongside direct messages, and this
 * surface is for broadcasts, events, the roster and management.
 *
 * Every subtab's data is fetched here, up front, in parallel, and handed to the
 * client SocietyShell as fully-loaded content — so switching tabs is an instant
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

  const supabase = await createClient();

  const [officers, upcoming, past, announcements, memberRows, pendingRows] =
    await Promise.all([
      getSocietyOfficers(id),
      getUpcomingSocietyEvents(id, 40),
      getPastSocietyEvents(id, 20),
      getSocietyAnnouncements(id, 50),
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

  const officerIds = new Set(officers.map((o) => o.user_id));
  type MemberRow = {
    user_id: string;
    profile: { id: string; full_name: string | null; username: string | null; avatar_url: string | null } | null;
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
    }));

  // remove_community_member() refuses to kick the owner or another manager, so
  // the removable set is exactly the non-officer roster.
  const removableMembers: CommunityMemberVM[] = followers.map((f) => ({
    user_id: f.id,
    full_name: f.full_name,
    username: f.username,
    avatar_url: f.avatar_url,
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
          announcements={announcements}
          canPost={canPost}
          canManage={canManage}
          isMember={viewer.isMember}
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
          viewer={{ role: viewer.role, isAdmin: viewer.isAdmin }}
        />
      ),
    });
  }

  return <SocietyShell ctx={ctx} proof={proof} tabs={tabs} />;
}
