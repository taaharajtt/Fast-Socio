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
import { ScreenHeader } from "@/components/ui";
import { markCommunityHubSeen } from "@/lib/community/seen";

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
      <ScreenHeader
        title="Community"
        subtitle={
          <Suspense fallback={<>What do you want?</>}>
            <CommunitySubtext />
          </Suspense>
        }
        action={<CreateSpaceButton />}
        className="mb-5"
      />
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

  // A bare string, not a <p>: this now renders *inside* ScreenHeader's own
  // subtitle paragraph, and a <p> nested in a <p> is invalid HTML the browser
  // silently un-nests — which would have broken the header layout.
  return <>{text}</>;
}

async function CommunitySections() {
  const supabase = await createClient();
  const me = (await getAuthUserId())!;

  // Opening the hub clears the hub-level Community badge items (new spaces,
  // memberships you were approved into, your own approvals) and the events
  // mark. It runs in `after()`, so THIS render still shows what was new and the
  // badge is gone by the next navigation — the same deferral the Notifications
  // panel uses. Items that live inside a specific space are untouched.
  markCommunityHubSeen();

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
      // The whole approved directory, not a top-30 slice. At 30 the cap was
      // silently hiding every newly approved community — they start at one
      // member, sort last, and never surfaced. The list is searchable client
      // side, so length costs scrolling, not discoverability.
      .limit(200),
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

  // Second stage: how many members of these spaces are online right now.
  //
  // This used to be TWO more serial round trips on top of the fan-out above —
  // three stages in all. It pulled every (community_id, user_id) pair in scope
  // (`.limit(4000)`) to the app server, de-duplicated the user ids, made a
  // SECOND query for their presence rows, and intersected the two in JS. ~4000
  // rows crossed the wire to produce roughly twenty integers, and the presence
  // read could not even start until the roster read had finished.
  //
  // `community_active_counts` (migration 0172) does the join and the GROUP BY
  // in Postgres and returns one row per community, so the third stage is gone
  // rather than merely moved, and the mutuals query below now runs in parallel
  // with it instead of after it.
  //
  // Visibility is UNCHANGED: the function is SECURITY INVOKER, so RLS on
  // profile_presence still hides students who have turned show_online off. It
  // remains an undercount, never a leak — see the note in 0172 on why this is
  // deliberately not a definer function.
  //
  // The online window is passed in from lib/time so the server and the client
  // dot are computed from one definition.
  const rosterScope = [...new Set([...spaceIds, ...verified.map((v) => v.id)])];
  const [{ data: activeRows }, { data: mutualRows }] = await Promise.all([
    rosterScope.length
      ? supabase.rpc("community_active_counts", {
          p_community_ids: rosterScope,
          p_since: onlineSinceIso(),
        })
      : Promise.resolve({ data: [] as { cid: string; active_count: number }[] }),
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

  const activeBySpace = new Map<string, number>(
    ((activeRows ?? []) as { cid: string; active_count: number }[]).map((r) => [
      r.cid,
      Number(r.active_count ?? 0),
    ])
  );

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
