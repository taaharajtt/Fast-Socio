import { Suspense } from "react";
import { SkeletonRows } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import {
  CommunityMainView,
  CreateSpaceButton,
  type YourSpaceVM,
  type TileVM,
} from "@/components/communities/community-main-view";
import { eventBadge } from "@/lib/events/format";
import type { ChatRoomCardVM } from "@/components/communities/chat-room-card";
import type { JoinState } from "@/app/(student)/communities/actions";
import { onlineSinceIso } from "@/lib/time";
import { SectionLogo } from "@/components/ui/section-logo";

type CommunityLite = {
  id: string;
  name: string;
  avatar_url: string | null;
  cover_url: string | null;
  is_society: boolean;
  is_official: boolean;
};

type ChatRoomRow = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  member_count: number;
  owner_id: string;
};

const COMMUNITY_LITE = "id, name, avatar_url, cover_url, is_society, is_official";

/**
 * The Community hub (dock tab "Community"): Your Spaces → Verified Communities
 * → Events → Community Chats, in that order and nothing else. The first three
 * are compact horizontal rails; only the chats get full-width cards, because
 * only they carry Follow/Join actions.
 *
 * Discovery and management only — no conversation is rendered on this page or
 * anywhere under Community. Talking happens in Chat.
 */
// No `unstable_instant` export here — it only adds build-time validation, and
// that validation currently trips on @sentry/nextjs reading the `sentry-trace`
// header during every server render. See the note in next.config.ts; the static
// shell itself is unaffected (this route builds as Partial Prerender).

/**
 * Community hub. The heading and the "create a space" affordance are the same
 * for everyone, so they prerender and the tab lands on a real screen at once;
 * the four data-backed sections (your spaces, verified communities, upcoming
 * events, chat rooms) stream in below as one unit.
 */
export default function CommunitiesPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <SectionLogo />
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">Community</h1>
            <Suspense fallback={<p className="mt-1 text-sm text-fg-muted">What do you want?</p>}>
              <CommunitySubtext />
            </Suspense>
          </div>
        </div>
        <CreateSpaceButton />
      </div>
      <Suspense fallback={<SkeletonRows count={5} />}>
        <CommunitySections />
      </Suspense>
    </main>
  );
}

async function CommunitySubtext() {
  const supabase = await createClient();
  const me = (await getAuthUserId())!;
  const { data: profile } = await supabase
    .from("profiles")
    // `full_name`, NOT `display_name`: the column exists but is null for all 144
    // production profiles, so reading it would have silently rendered the nameless
    // fallback forever. `full_name` is the name the rest of the app displays.
    .select("full_name")
    .eq("id", me)
    .maybeSingle();

  const trimmed = (profile?.full_name ?? "").trim();
  const full = trimmed.length > 18 ? trimmed.split(" ")[0] : trimmed;
  const text = full ? `What do you want, ${full}?` : "What do you want?";

  return <p className="mt-1 truncate text-sm text-fg-muted">{text}</p>;
}

async function CommunitySections() {
  const supabase = await createClient();
  const me = (await getAuthUserId())!;

  const [
    { data: memberRows },
    { data: followRows },
    { data: verifiedRows },
    { data: eventRows },
    { data: chatRoomRows },
    { data: requestRows },
    { data: matchRows },
  ] = await Promise.all([
    supabase
      .from("community_members")
      .select(`community:communities(${COMMUNITY_LITE})`)
      .eq("user_id", me),
    supabase
      .from("community_followers")
      .select(`community:communities(${COMMUNITY_LITE})`)
      .eq("user_id", me),
    supabase
      .from("communities")
      .select("id, name, avatar_url, cover_url, member_count, is_official")
      .eq("status", "approved")
      .or("is_society.eq.true,is_official.eq.true")
      .order("is_official", { ascending: false })
      .order("member_count", { ascending: false })
      .limit(20),
    supabase
      .from("events")
      .select("id, title, cover_url, starts_at")
      .eq("status", "approved")
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(20),
    supabase
      .from("communities")
      .select("id, name, description, avatar_url, cover_url, member_count, owner_id")
      .eq("status", "approved")
      .eq("is_society", false)
      // Discover team rooms (mig 0129) are communities under the hood, but they
      // are private to the team that formed them — never browsable here.
      .eq("is_discover_group", false)
      .order("member_count", { ascending: false })
      .limit(30),
    supabase.from("community_join_requests").select("community_id, status").eq("user_id", me),
    supabase
      .from("matches")
      .select("user_low, user_high")
      .or(`user_low.eq.${me},user_high.eq.${me}`),
  ]);

  // Your spaces = everything you follow OR participate in, deduped.
  type Joined = { community: CommunityLite | null };
  const spaceMap = new Map<string, CommunityLite>();
  for (const r of [
    ...((memberRows ?? []) as unknown as Joined[]),
    ...((followRows ?? []) as unknown as Joined[]),
  ]) {
    if (r.community) spaceMap.set(r.community.id, r.community);
  }
  const spaceIds = [...spaceMap.keys()];

  const chatRooms = (chatRoomRows ?? []) as ChatRoomRow[];
  const matchIds = ((matchRows ?? []) as { user_low: string; user_high: string }[]).map(
    (m) => (m.user_low === me ? m.user_high : m.user_low)
  );

  const verified = (verifiedRows ?? []) as {
    id: string;
    name: string;
    avatar_url: string | null;
    cover_url: string | null;
    member_count: number;
    is_official: boolean;
  }[];

  // Second stage: who is in these spaces, and which of them are online. The
  // roster covers both Your Spaces (for the active dot) and the verified rail
  // (for its active/members tag), so one query serves both.
  const rosterScope = [...new Set([...spaceIds, ...verified.map((v) => v.id)])];
  const [{ data: rosterRows }, { data: mutualRows }] = await Promise.all([
    rosterScope.length
      ? supabase
          .from("community_members")
          .select("community_id, user_id")
          .in("community_id", rosterScope)
          .limit(4000)
      : Promise.resolve({ data: [] as { community_id: string; user_id: string }[] }),
    matchIds.length && chatRooms.length
      ? supabase
          .from("community_members")
          .select("community_id, user_id")
          .in(
            "community_id",
            chatRooms.map((c) => c.id)
          )
          .in("user_id", matchIds)
      : Promise.resolve({ data: [] as { community_id: string; user_id: string }[] }),
  ]);

  const roster = (rosterRows ?? []) as { community_id: string; user_id: string }[];
  const rosterIds = [...new Set(roster.map((r) => r.user_id))];

  // profile_presence is RLS-gated on the owner's show_online, so this counts
  // only students who publish their presence — an undercount, never a leak.
  const { data: presenceRows } = rosterIds.length
    ? await supabase
        .from("profile_presence")
        .select("id")
        .in("id", rosterIds)
        .gt("last_seen_at", onlineSinceIso())
    : { data: [] as { id: string }[] };
  const online = new Set((presenceRows ?? []).map((p) => p.id));

  const activeBySpace = new Map<string, number>();
  for (const r of roster) {
    if (online.has(r.user_id))
      activeBySpace.set(r.community_id, (activeBySpace.get(r.community_id) ?? 0) + 1);
  }

  const mutualsByRoom = new Map<string, number>();
  for (const r of (mutualRows ?? []) as { community_id: string }[]) {
    mutualsByRoom.set(r.community_id, (mutualsByRoom.get(r.community_id) ?? 0) + 1);
  }

  const followedIds = new Set(
    ((followRows ?? []) as unknown as Joined[]).map((r) => r.community?.id).filter(Boolean) as string[]
  );
  const memberIds = new Set(
    ((memberRows ?? []) as unknown as Joined[]).map((r) => r.community?.id).filter(Boolean) as string[]
  );
  const requestStatus = new Map(
    ((requestRows ?? []) as { community_id: string; status: string }[]).map((r) => [
      r.community_id,
      r.status as JoinState,
    ])
  );

  const yourSpaces: YourSpaceVM[] = [...spaceMap.values()].map((c) => ({
    id: c.id,
    name: c.name,
    avatar_url: c.avatar_url,
    cover_url: c.cover_url,
    isSociety: c.is_society,
    isOfficial: c.is_official,
    activeNow: activeBySpace.get(c.id) ?? 0,
  }));

  const verifiedCommunities: TileVM[] = verified.map((s) => {
    const activeNow = activeBySpace.get(s.id) ?? 0;
    return {
      id: s.id,
      name: s.name,
      image: s.avatar_url ?? s.cover_url,
      href: `/societies/${s.id}`,
      verified: s.is_official,
      activeNow,
      meta:
        `${s.member_count.toLocaleString()} member${s.member_count === 1 ? "" : "s"}` +
        (activeNow > 0 ? ` · ${activeNow} active` : ""),
    };
  });

  const upcomingEvents: TileVM[] = (
    (eventRows ?? []) as { id: string; title: string; cover_url: string | null; starts_at: string }[]
  ).map((e) => {
    const b = eventBadge(e.starts_at);
    return {
      id: e.id,
      name: e.title,
      image: e.cover_url,
      href: `/events/${e.id}`,
      badge: `${b.day} ${b.month}`,
    };
  });

  const chatRoomCards: ChatRoomCardVM[] = chatRooms.map((c) => {
    const isOwner = c.owner_id === me;
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      avatar_url: c.avatar_url,
      cover_url: c.cover_url,
      member_count: c.member_count,
      mutuals: mutualsByRoom.get(c.id) ?? 0,
      isFollowing: isOwner || followedIds.has(c.id),
      joinStatus: isOwner || memberIds.has(c.id) ? "joined" : (requestStatus.get(c.id) ?? "none"),
      isOwner,
    };
  });

  return (
    <CommunityMainView
      yourSpaces={yourSpaces}
      verifiedCommunities={verifiedCommunities}
      upcomingEvents={upcomingEvents}
      chatRooms={chatRoomCards}
    />
  );
}
