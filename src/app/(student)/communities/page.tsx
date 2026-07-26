import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import {
  CommunityMainView,
  CreationModalTrigger,
  type YourSpaceVM,
  type UpcomingEventVM,
} from "@/components/communities/community-main-view";
import type { CommunityVM } from "@/components/communities/community-browser";
import type { SocietyCategory } from "@/lib/societies/logic";
import type { SocietyCardVM } from "@/lib/societies/types";
import { eventBadge } from "@/lib/events/format";

type SpaceRow = {
  role: "owner" | "moderator" | "member";
  community: {
    id: string;
    name: string;
    avatar_url: string | null;
    cover_url: string | null;
    is_society: boolean;
  } | null;
};

type VerifiedRow = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  member_count: number;
  society_category: string | null;
  is_official: boolean;
  recruitment_open: boolean;
};

type EventRow = {
  id: string;
  title: string;
  location: string | null;
  cover_url: string | null;
  starts_at: string;
  attendee_count: number;
  host_id: string;
  community_id: string | null;
};

type ChatRoomRow = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  member_count: number;
  status: string;
  owner_id: string;
};

/**
 * The Community hub (dock tab "Community"): Your Spaces, Verified
 * Communities, Upcoming Events, and Chat Rooms — nothing else. Every space a
 * student can reach from campus life funnels through here.
 */
export default async function CommunitiesPage() {
  const supabase = await createClient();
  const me = (await getAuthUserId())!;

  const [
    { data: spaceRows },
    { data: officerRows },
    { data: verifiedRows },
    { data: eventRows },
    { data: chatRoomRows },
  ] = await Promise.all([
    supabase
      .from("community_members")
      .select("role, community:communities(id, name, avatar_url, cover_url, is_society)")
      .eq("user_id", me),
    supabase.from("society_roles").select("society_id").eq("user_id", me),
    supabase
      .from("communities")
      .select(
        "id, name, description, avatar_url, cover_url, member_count, society_category, is_official, recruitment_open"
      )
      .eq("status", "approved")
      .or("is_society.eq.true,is_official.eq.true")
      .order("is_official", { ascending: false })
      .order("member_count", { ascending: false }),
    supabase
      .from("events")
      .select(
        "id, title, location, cover_url, starts_at, attendee_count, host_id, community_id"
      )
      .eq("status", "approved")
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(10),
    supabase
      .from("communities")
      .select("id, name, description, avatar_url, cover_url, member_count, status, owner_id")
      .eq("status", "approved")
      .eq("is_society", false)
      .order("member_count", { ascending: false }),
  ]);

  const officerSocietyIds = new Set((officerRows ?? []).map((r) => r.society_id as string));
  const yourSpaces: YourSpaceVM[] = ((spaceRows ?? []) as unknown as SpaceRow[])
    .filter((r) => r.community)
    .map((r) => {
      const c = r.community!;
      const role: YourSpaceVM["role"] =
        r.role === "owner"
          ? "Owner"
          : r.role === "moderator" || (c.is_society && officerSocietyIds.has(c.id))
            ? "Officer"
            : "Member";
      return {
        id: c.id,
        name: c.name,
        avatar_url: c.avatar_url,
        cover_url: c.cover_url,
        role,
        isSociety: c.is_society,
      };
    });

  const verifiedCommunities: SocietyCardVM[] = ((verifiedRows ?? []) as VerifiedRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    avatar_url: s.avatar_url,
    cover_url: s.cover_url,
    member_count: s.member_count,
    category: (s.society_category as SocietyCategory | null) ?? null,
    isOfficial: s.is_official,
    isRecruiting: s.recruitment_open,
    isFollowing: yourSpaces.some((sp) => sp.id === s.id),
    upcomingEvents: 0,
  }));

  const events = (eventRows ?? []) as EventRow[];
  const hostIds = [...new Set(events.map((e) => e.host_id))];
  const communityIds = [...new Set(events.map((e) => e.community_id).filter(Boolean) as string[])];
  const [{ data: hosts }, { data: comms }] = await Promise.all([
    hostIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", hostIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    communityIds.length
      ? supabase.from("communities").select("id, name").in("id", communityIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const hostName = new Map((hosts ?? []).map((h) => [h.id, h.full_name]));
  const commName = new Map((comms ?? []).map((c) => [c.id, c.name]));

  const upcomingEvents: UpcomingEventVM[] = events.map((e) => {
    const b = eventBadge(e.starts_at);
    return {
      id: e.id,
      title: e.title,
      organizer:
        (e.community_id && commName.get(e.community_id)) || hostName.get(e.host_id) || "FAST Socio",
      location: e.location,
      cover_url: e.cover_url,
      day: b.day,
      month: b.month,
      attendee_count: e.attendee_count,
    };
  });

  const chatRooms: CommunityVM[] = ((chatRoomRows ?? []) as ChatRoomRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    avatar_url: c.avatar_url,
    cover_url: c.cover_url,
    member_count: c.member_count,
    isMember: yourSpaces.some((sp) => sp.id === c.id) || c.owner_id === me,
    isOwner: c.owner_id === me,
  }));

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Community</h1>
          <p className="mt-1 text-sm text-fg-muted">Campus Spaces &amp; Societies</p>
        </div>
        <CreationModalTrigger />
      </div>

      <CommunityMainView
        yourSpaces={yourSpaces}
        verifiedCommunities={verifiedCommunities}
        upcomingEvents={upcomingEvents}
        chatRooms={chatRooms}
      />
    </main>
  );
}
