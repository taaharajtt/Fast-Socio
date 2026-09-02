"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { resolveAvatarUrl } from "@/lib/avatar";
import { checkRateLimitResult, limitedMessage } from "@/lib/rate-limit";
import { orIlike } from "@/lib/postgrest/search";
import { isPostMode, type PostMode } from "@/lib/smart-match/modes";
import {
  buildSwipeDeck,
  INTENT_KINDS,
} from "@/lib/discover/cards";
import {
  EMPTY_DECK_PAGE,
  type DiscoverDeckPage,
} from "@/lib/discover/deck-pager";
import {
  buildPostPayload,
  validatePostInput,
  normalizeSkills,
  type PostFormValues,
} from "@/lib/smart-match/validate";
import type { DiscoverProfile } from "@/lib/profile/types";
import type {
  IncomingApplication,
  MyDiscoverData,
  MyIntent,
  MyApplication,
  PostStatus,
  RecruitAnchor,
  SmartMatchPost,
  SmartMatchViewer,
  TeamMember,
} from "@/lib/smart-match/types";

type Result = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Server actions for the unified Discover feed. Every cross-user read of other
// people's opportunity posts goes exclusively through the
// get_unified_discover_feed SECURITY DEFINER RPC (migs 0105 + 0110); every
// write goes through the definer create/update/respond RPCs. SOCIO keeps its
// own untouched path: get_discover_candidates + discover/actions.ts.
// ---------------------------------------------------------------------------

/**
 * The viewer facts scoring needs from their own profile. Server-only.
 *
 * REQUEST-MEMOISED (perf audit Phase 4). /discover renders two independent
 * Suspense slots — <DeckSlot/> and <PostButtonSlot/> — and both need the
 * viewer, so this ran TWICE per page load. It is two sequential round trips
 * each (the profile row, then `current_semester`), so the page was paying four
 * legs to Frankfurt for one viewer. React `cache()` collapses that to two for
 * the whole request; the two slots still stream independently, they just share
 * the read instead of racing it.
 *
 * The `current_semester` RPC is deliberately KEPT rather than reimplemented in
 * TypeScript. It is a second network leg to turn a roll number into an integer,
 * which is tempting to inline — but there is no TS mirror of it today, and
 * adding one would create a second definition of "which semester is this
 * student in" that can silently drift from the SQL. `get_discover_candidates`
 * scores on the SQL value, so a drifted client would show a compatibility
 * number the deck did not use. One definition is worth one round trip.
 *
 * Not exported, so wrapping it here does not violate the module's "use server"
 * contract (every EXPORT must be an async function).
 */
const getDiscoverViewer = cache(async (): Promise<SmartMatchViewer | null> => {
  const uid = await getAuthUserId();
  if (!uid) return null;
  const supabase = await createClient();
  const { data: prof } = await supabase
    .from("profiles")
    .select("username, department, graduation_year, interests, skills, semester, degree")
    .eq("id", uid)
    .maybeSingle();
  if (!prof) return null;

  let semester: number | null =
    typeof prof.semester === "number" ? prof.semester : null;
  if (prof.username) {
    const { data } = await supabase.rpc("current_semester", {
      p_username: prof.username,
    });
    if (typeof data === "number") semester = data;
  }

  return {
    department: prof.department ?? null,
    semester,
    graduationYear: (prof.graduation_year as number | null) ?? null,
    interests: (prof.interests as string[] | null) ?? [],
    skills: (prof.skills as string[] | null) ?? [],
    degree: (prof.degree as string | null) ?? null,
  };
});

type PostRow = {
  id: string;
  mode: string;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
  author_gender: string | null;
  author_username: string | null;
  author_department: string | null;
  author_semester: number | null;
  author_graduation_year: number | null;
  author_verified: boolean | null;
  author_aura: number | null;
  title: string;
  description: string | null;
  course_code: string | null;
  degree: string | null;
  semester: number | null;
  people_needed: number | null;
  skills_needed: string[] | null;
  interests: string[] | null;
  roles_needed: string[] | null;
  place: string | null;
  place_id?: string | null;
  place_x?: number | null;
  place_y?: number | null;
  scheduled_at: string | null;
  hackathon_name: string | null;
  hackathon_url: string | null;
  meeting_preference: string | null;
  preferred_commitment: string | null;
  skill_level: string | null;
  availability: string | null;
  portfolio_url: string | null;
  recruitment_url: string | null;
  deadline: string | null;
  expires_at: string | null;
  society_id: string | null;
  society_name: string | null;
  event_id: string | null;
  event_title: string | null;
  team_members: TeamMember[] | null;
  team_member_count: number | null;
  mutual_communities: number | null;
  application_count: number | null;
  my_application_status: SmartMatchPost["myApplicationStatus"];
  my_application_id: string | null;
  created_at: string;
};

function mapPost(r: PostRow): SmartMatchPost {
  const team = (r.team_members ?? []) as unknown as Array<{
    id: string;
    username: string | null;
    full_name: string | null;
    avatar_url: string | null;
    gender: string | null;
  }>;
  return {
    id: r.id,
    mode: r.mode as PostMode,
    authorId: r.author_id,
    authorName: r.author_name,
    // Gender resolves to a default face here, at the one boundary every
    // Discover surface goes through, so no card has to know about it.
    authorAvatar: resolveAvatarUrl(r.author_avatar, r.author_gender),
    authorUsername: r.author_username,
    authorDepartment: r.author_department,
    authorSemester: r.author_semester,
    authorGraduationYear: r.author_graduation_year,
    authorVerified: Boolean(r.author_verified),
    authorAura: r.author_aura ?? 0,
    title: r.title,
    description: r.description,
    courseCode: r.course_code,
    degree: r.degree,
    semester: r.semester,
    peopleNeeded: r.people_needed,
    skillsNeeded: r.skills_needed ?? [],
    interests: r.interests ?? [],
    rolesNeeded: r.roles_needed ?? [],
    place: r.place,
    // Only present on rows selected with "*" (own posts) — the shared feed
    // RPC's return table predates mig 0138 and isn't in scope here (no
    // migrations may be written for this task), so cards fed from it fall
    // back to string-matching `place` via resolvePlace().
    placeId: r.place_id ?? null,
    placeX: r.place_x ?? null,
    placeY: r.place_y ?? null,
    scheduledAt: r.scheduled_at,
    hackathonName: r.hackathon_name,
    hackathonUrl: r.hackathon_url,
    meetingPreference: r.meeting_preference,
    preferredCommitment: r.preferred_commitment,
    skillLevel: r.skill_level,
    availability: r.availability,
    portfolioUrl: r.portfolio_url,
    recruitmentUrl: r.recruitment_url,
    deadline: r.deadline,
    expiresAt: r.expires_at,
    societyId: r.society_id,
    societyName: r.society_name,
    eventId: r.event_id,
    eventTitle: r.event_title,
    teamMembers: team.map((t) => ({
      id: t.id,
      username: t.username,
      fullName: t.full_name,
      avatarUrl: resolveAvatarUrl(t.avatar_url, t.gender),
    })),
    teamMemberCount: r.team_member_count ?? 0,
    mutualCommunities: r.mutual_communities ?? 0,
    applicationCount: r.application_count ?? 0,
    myApplicationStatus: r.my_application_status ?? null,
    myApplicationId: r.my_application_id ?? null,
    createdAt: r.created_at,
  };
}

/**
 * One page of open intent posts, newest first, WITH its keyset continuation.
 *
 * The cursor is `(created_at, id)` of the last RAW row of the page — before any
 * client-side eligibility filtering — so posts the deck drops still advance the
 * cursor instead of being re-fetched, and no eligible post is skipped when the
 * page it lived on was partly filtered out. `hasMore` is a full page: the only
 * authoritative signal that this feed still has something to give.
 */
export async function getDiscoverIntentsPage({
  cursor = null,
  cursorId = null,
  limit = 40,
  modes = INTENT_KINDS,
}: {
  cursor?: string | null;
  cursorId?: string | null;
  limit?: number;
  modes?: readonly PostMode[];
} = {}): Promise<{
  posts: SmartMatchPost[];
  cursor: string | null;
  cursorId: string | null;
  hasMore: boolean;
}> {
  const capped = Math.max(1, Math.min(limit, 80));
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_unified_discover_feed", {
    p_modes: [...modes],
    p_limit: capped,
    p_before: cursor,
    p_before_id: cursorId,
  });
  const rows = (data as PostRow[]) ?? [];
  const last = rows.length ? rows[rows.length - 1] : null;
  return {
    posts: rows.map(mapPost),
    cursor: last ? last.created_at : cursor,
    cursorId: last ? last.id : cursorId,
    hasMore: rows.length >= capped,
  };
}

/** Posts only, for callers that don't page (map, sports strip). */
export async function getDiscoverIntents(args: {
  cursor?: string | null;
  limit?: number;
  modes?: readonly PostMode[];
} = {}): Promise<SmartMatchPost[]> {
  const { posts } = await getDiscoverIntentsPage(args);
  return posts;
}

/**
 * Open Sports plans for the Campus Map's "active games" display (M0). Reuses
 * the same definer feed as Discover, so it's subject to the same privacy
 * rules — notably it excludes the caller's OWN sports plan, same as Discover
 * never shows you your own card.
 */
export async function getActiveSportsPlans(): Promise<SmartMatchPost[]> {
  return getDiscoverIntents({ modes: ["sports"], limit: 80 });
}

/** Upper bound on the SOCIO exclusion set carried in one request. */
const MAX_SOCIO_EXCLUDE = 500;

/**
 * SOCIO swipe candidates. `exclude` is the continuation: the candidate ids the
 * caller already holds, which migration 0157's `p_exclude` drops server-side so
 * the next call returns the best of the REST under the same ranking. Ranking,
 * privacy and recycling rules are untouched.
 *
 * The rows come back in final deck order and `buildSwipeDeck` preserves it, so
 * the gender-balanced pacing migration 0158 applies for female viewers (2
 * female : 1 other, mirrored and unit-tested in `lib/discover/gender-pacing.ts`)
 * arrives here already applied — the client must not re-sort SOCIO cards.
 */
/*
 * PERFORMANCE NOTE (perf audit Phase 4, 2026-08-31). `get_discover_candidates`
 * is the most expensive thing this app does — 8,168 calls at a 249ms mean and
 * a 7.5s max over 19.6 days. Measured on production before changing anything:
 *
 *   warm, same connection            20 ms  (viewer with 55 eligible candidates)
 *                                    70 ms  (viewer with ~480 eligible)
 *   cold, fresh pooled connection   146 ms  (~480 eligible)
 *   same viewer, seconds apart       44 ms and 393 ms
 *
 * So cost tracks the size of the ELIGIBLE SET (0158 ranks and paces the whole
 * set before LIMIT, deliberately), plus per-connection planning, plus a lot of
 * contention. The slowest experience belongs to a brand new account: the
 * emptiest deck is the most expensive one.
 *
 * THREE OPTIMISATIONS WERE TRIED AND REJECTED ON MEASUREMENT, so please do not
 * re-derive them from reading the SQL:
 *
 *  1. `scored as materialized`, to stop the shared-interests lateral being
 *     evaluated 4x per row (EXPLAIN really does show SubPlans 11/17/18/19).
 *     It was written, applied and REVERTED. A first A/B showed 126ms -> 71ms,
 *     but that A/B ran the old version cold and the new one warm in the same
 *     transaction. Re-run with both plans pre-warmed and the order reversed:
 *     73.5 vs 75.5, 67.4 vs 71.3, 20.6 vs 20.3 ms — i.e. nothing. Output was
 *     byte-identical (md5 of the full result set) in both directions, so it
 *     was safe; it simply was not a win.
 *  2. A partial index on the eligibility predicate. The plan shows the profiles
 *     scan is 50 buffers / 0.88 ms of a 146 ms query. On ~650 rows a seq scan
 *     is already right.
 *  3. Pre-filtering before the window functions. The windows run over 55-480
 *     rows and quicksort in ~48 kB. Not the bottleneck, and cutting the set
 *     early would risk the pacing and recycling behaviour 0158 exists to
 *     provide.
 *
 * What is left, and unmeasured: planning cost (the body has ~20 CTEs and four
 * window functions; the inlined plan reported 27.9 ms of PLANNING alone) and
 * contention from other work on the same instance. Both need a different kind
 * of change than tuning this query.
 */
export async function getSocioSwipeCandidates(
  limit = 20,
  exclude: string[] = [],
  /**
   * The client's per-session shuffle seed (UAT-15). Null means "no shuffle",
   * which is the pre-0178 ordering exactly — the seed has to reach EVERY page of
   * a session or pagination breaks, so it is threaded through rather than
   * generated here, where each call would invent a different one.
   */
  seed: string | null = null
): Promise<DiscoverProfile[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_discover_candidates", {
    p_limit: limit,
    // Bounded: the exclusion set travels in every request, and a session that
    // pages far enough would otherwise grow it without limit.
    p_exclude: exclude.slice(-MAX_SOCIO_EXCLUDE),
    p_seed: seed,
  });
  return (data as DiscoverProfile[]) ?? [];
}

/**
 * The whole Discover deck as ONE normalized, pre-interleaved page: SOCIO people
 * and open intent posts, ranked and mixed, PLUS the continuation state the
 * client needs to ask for the next page.
 *
 * `socioHasMore` / `intentHasMore` are the only authority on exhaustion — an
 * empty local deck is not. Either limit may be 0, meaning "that source already
 * reported exhaustion, don't query it".
 */
export async function getDiscoverSwipeDeck({
  socioExclude = [],
  intentCursor = null,
  intentCursorId = null,
  socioLimit = 20,
  intentLimit = 40,
  seed = null,
}: {
  socioExclude?: string[];
  intentCursor?: string | null;
  intentCursorId?: string | null;
  socioLimit?: number;
  intentLimit?: number;
  /** Per-session shuffle seed (UAT-15); the same value on every page. */
  seed?: string | null;
} = {}): Promise<DiscoverDeckPage> {
  const uid = await getAuthUserId();
  if (!uid) return EMPTY_DECK_PAGE;
  const viewer = await getDiscoverViewer();
  if (!viewer) return EMPTY_DECK_PAGE;

  const [socio, intents] = await Promise.all([
    socioLimit > 0
      ? getSocioSwipeCandidates(socioLimit, socioExclude, seed)
      : Promise.resolve<DiscoverProfile[]>([]),
    intentLimit > 0
      ? getDiscoverIntentsPage({
          cursor: intentCursor,
          cursorId: intentCursorId,
          limit: intentLimit,
        })
      : Promise.resolve({
          posts: [] as SmartMatchPost[],
          cursor: intentCursor,
          cursorId: intentCursorId,
          hasMore: false,
        }),
  ]);

  return {
    cards: buildSwipeDeck({ socio, posts: intents.posts, viewer, viewerId: uid }),
    // Every candidate the server just handed over is excluded next time, even
    // the ones the client already had — that is what makes the page advance.
    socioContinuation: { excludeIds: socio.map((p) => p.id) },
    intentContinuation: { cursor: intents.cursor, cursorId: intents.cursorId },
    // A SHORT page is NOT exhaustion for this RPC. `get_discover_candidates`
    // is tiered: the recycle round (passed profiles) is gated behind
    // `not exists (select 1 from fresh)`, so a viewer with one fresh candidate
    // left gets a 1-row page, and the recycled people only appear on the NEXT
    // call once that one is excluded. Only an EMPTY page means done — verified
    // against prod, where a real account returned fresh=1, recycled=0 on page
    // one and five recycled profiles on page two.
    socioHasMore: socioLimit > 0 && socio.length > 0,
    intentHasMore: intents.hasMore,
  };
}

/** Societies / events the viewer may recruit for (recruitment create anchor). */
async function getRecruitAnchors(uid: string): Promise<RecruitAnchor[]> {
  const supabase = await createClient();
  const [{ data: roles }, { data: orgs }] = await Promise.all([
    supabase.from("society_roles").select("society_id").eq("user_id", uid),
    supabase.from("event_organizers").select("event_id").eq("user_id", uid),
  ]);
  const roleSocietyIds = (roles ?? []).map((r) => r.society_id as string);
  const orgEventIds = (orgs ?? []).map((r) => r.event_id as string);

  const anchors: RecruitAnchor[] = [];

  // Societies I own OR hold an officer role in.
  const societyFilter = roleSocietyIds.length
    ? `owner_id.eq.${uid},id.in.(${roleSocietyIds.join(",")})`
    : `owner_id.eq.${uid}`;
  const { data: socs } = await supabase
    .from("communities")
    .select("id, name")
    .eq("is_society", true)
    .eq("status", "approved")
    .or(societyFilter);
  for (const s of socs ?? [])
    anchors.push({ kind: "society", id: s.id as string, name: s.name as string });

  // Events I host OR co-organize.
  const eventFilter = orgEventIds.length
    ? `host_id.eq.${uid},id.in.(${orgEventIds.join(",")})`
    : `host_id.eq.${uid}`;
  const { data: evs } = await supabase
    .from("events")
    .select("id, title")
    .or(eventFilter);
  for (const e of evs ?? [])
    anchors.push({ kind: "event", id: e.id as string, name: e.title as string });

  return anchors;
}

/**
 * The viewer's OWN Discover state — what the Post Intent sheet shows under
 * "My posts". Own posts never appear in the swipe deck (you don't swipe on
 * yourself), so this is where you manage them: edit, close, and answer the
 * requests they've attracted. RLS lets a user read their own posts directly;
 * the definer feed RPC deliberately excludes them.
 */
export async function getMyDiscoverData(): Promise<MyDiscoverData | null> {
  const uid = await getAuthUserId();
  if (!uid) return null;
  const viewer = await getDiscoverViewer();
  if (!viewer) return null;
  const supabase = await createClient();

  const [{ data: mine }, { data: myProfile }] = await Promise.all([
    supabase
      .from("smart_match_posts")
      .select("*")
      .eq("author_id", uid)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("profiles")
      .select(
        "full_name, username, avatar_url, gender, department, graduation_year, verified, aura_score"
      )
      .eq("id", uid)
      .maybeSingle(),
  ]);

  const myRows = (mine ?? []) as Array<Record<string, unknown>>;
  const myPostIds = myRows.map((r) => r.id as string);

  // My own open posts, shaped exactly like feed rows.
  const myTeamByPost = new Map<string, TeamMember[]>();
  if (myPostIds.length) {
    const { data: tms } = await supabase
      .from("smart_match_team_members")
      .select("post_id, user_id")
      .in("post_id", myPostIds);
    const rows = (tms ?? []) as Array<{ post_id: string; user_id: string }>;
    const memberIds = [...new Set(rows.map((r) => r.user_id))];
    const { data: memberProfiles } = memberIds.length
      ? await supabase
          .from("profiles")
          .select("id, full_name, username, avatar_url, gender")
          .in("id", memberIds)
      : { data: [] as unknown[] };
    const byId = new Map(
      (memberProfiles ?? []).map((p) => {
        const m = p as {
          id: string;
          full_name: string | null;
          username: string | null;
          avatar_url: string | null;
          gender: string | null;
        };
        return [
          m.id,
          {
            id: m.id,
            username: m.username,
            fullName: m.full_name,
            avatarUrl: resolveAvatarUrl(m.avatar_url, m.gender),
          } satisfies TeamMember,
        ];
      })
    );
    for (const r of rows) {
      const member = byId.get(r.user_id);
      if (!member) continue;
      myTeamByPost.set(r.post_id, [...(myTeamByPost.get(r.post_id) ?? []), member]);
    }
  }

  const me = (myProfile ?? {}) as {
    full_name?: string | null;
    username?: string | null;
    avatar_url?: string | null;
    gender?: string | null;
    department?: string | null;
    graduation_year?: number | null;
    verified?: boolean | null;
    aura_score?: number | null;
  };

  const myFullPosts = myRows.map((r) => {
    const team = myTeamByPost.get(r.id as string) ?? [];
    return {
      ...mapPost({
        ...(r as unknown as PostRow),
        author_name: me.full_name ?? null,
        author_avatar: me.avatar_url ?? null,
        author_gender: me.gender ?? null,
        author_username: me.username ?? null,
        author_department: me.department ?? null,
        author_semester: viewer.semester,
        author_graduation_year: me.graduation_year ?? null,
        author_verified: me.verified ?? false,
        author_aura: me.aura_score ?? 0,
        society_name: null,
        event_title: null,
        team_members: null,
        team_member_count: team.length,
        mutual_communities: 0,
        application_count: 0,
        my_application_status: null,
        my_application_id: null,
      }),
      teamMembers: team,
      status: r.status as PostStatus,
    };
  });

  // Incoming applications on my own posts (author view). RLS lets the post
  // author read these; we join applicant profiles for display.
  let incoming: IncomingApplication[] = [];
  const pendingByPost = new Map<string, number>();
  if (myPostIds.length) {
    const { data: apps } = await supabase
      .from("smart_match_applications")
      .select("id, post_id, applicant_id, message, status, created_at")
      .in("post_id", myPostIds)
      .order("created_at", { ascending: false });
    const appRows = (apps ?? []) as Array<{
      id: string;
      post_id: string;
      applicant_id: string;
      message: string | null;
      status: IncomingApplication["status"];
      created_at: string;
    }>;
    const titleById = new Map(
      myRows.map((r) => [r.id as string, r.title as string])
    );
    const applicantIds = [...new Set(appRows.map((a) => a.applicant_id))];
    const { data: profs } = applicantIds.length
      ? await supabase
          .from("profiles")
          .select("id, full_name, username, avatar_url, gender")
          .in("id", applicantIds)
      : { data: [] as unknown[] };
    const byId = new Map(
      (profs ?? []).map((p) => [
        (p as { id: string }).id,
        p as {
          id: string;
          full_name: string | null;
          username: string | null;
          avatar_url: string | null;
          gender: string | null;
        },
      ])
    );
    for (const a of appRows) {
      if (a.status === "pending")
        pendingByPost.set(a.post_id, (pendingByPost.get(a.post_id) ?? 0) + 1);
    }
    incoming = appRows
      .filter((a) => a.status === "pending")
      .map((a) => {
        const p = byId.get(a.applicant_id);
        return {
          id: a.id,
          postId: a.post_id,
          postTitle: titleById.get(a.post_id) ?? "",
          status: a.status,
          message: a.message,
          createdAt: a.created_at,
          applicantId: a.applicant_id,
          applicantName: p?.full_name ?? null,
          applicantUsername: p?.username ?? null,
          applicantAvatar: resolveAvatarUrl(p?.avatar_url, p?.gender),
        };
      });
  }

  // Rooms already minted from these posts (UAT-07). One read for the whole
  // page rather than one per row, and `discover_post_id` is the column
  // `create_discover_group_chat` writes, so this is the same identity the RPC
  // uses to stay idempotent.
  const groupByPost = new Map<string, string>();
  if (myFullPosts.length > 0) {
    const { data: roomRows } = await supabase
      .from("communities")
      .select("id, discover_post_id")
      .in(
        "discover_post_id",
        myFullPosts.map((p) => p.id)
      );
    for (const r of roomRows ?? [])
      groupByPost.set(r.discover_post_id as string, r.id as string);
  }

  const myPosts: MyIntent[] = myFullPosts.map((p) => ({
    ...p,
    pendingCount: pendingByPost.get(p.id) ?? 0,
    groupId: groupByPost.get(p.id) ?? null,
  }));

  // UAT-09: applications the VIEWER sent. RLS lets an applicant read their own
  // rows, and the post is embedded so the row can name what was applied to
  // without a second round trip. Bounded — this is a status list, not history.
  const { data: outRows } = await supabase
    .from("smart_match_applications")
    .select(
      "id, post_id, message, status, created_at, responded_at, post:smart_match_posts!smart_match_applications_post_id_fkey(id, title, mode)"
    )
    .eq("applicant_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);

  const outgoing: MyApplication[] = (
    (outRows ?? []) as unknown as Array<{
      id: string;
      post_id: string;
      message: string | null;
      status: MyApplication["status"];
      created_at: string;
      responded_at: string | null;
      post: { id: string; title: string; mode: string } | null;
    }>
  ).map((a) => ({
    id: a.id,
    postId: a.post_id,
    // A deleted post leaves the application row behind; it must still render as
    // something rather than as an empty line.
    postTitle: a.post?.title ?? "A removed post",
    mode: a.post?.mode ?? "",
    status: a.status,
    message: a.message,
    createdAt: a.created_at,
    respondedAt: a.responded_at,
  }));

  return {
    viewer,
    myPosts,
    incoming,
    outgoing,
    recruitAnchors: await getRecruitAnchors(uid),
  };
}

/**
 * The current user's match partner ids (either side of the canonical
 * user_low/user_high pair in `matches`). Used to scope who can be tagged as a
 * team member on a Discover post — matches only, resolved server-side.
 */
async function getMatchIds(uid: string): Promise<string[]> {
  const supabase = await createClient();
  const [{ data: asLow }, { data: asHigh }] = await Promise.all([
    supabase.from("matches").select("user_high").eq("user_low", uid),
    supabase.from("matches").select("user_low").eq("user_high", uid),
  ]);
  const ids = new Set<string>();
  for (const r of asLow ?? []) ids.add((r as { user_high: string }).user_high);
  for (const r of asHigh ?? []) ids.add((r as { user_low: string }).user_low);
  return [...ids];
}

/** Whether the current user has any matches at all — drives the tagger's empty state. */
export async function hasAnyMatches(): Promise<boolean> {
  const uid = await getAuthUserId();
  if (!uid) return false;
  const matchIds = await getMatchIds(uid);
  return matchIds.length > 0;
}

/** Search the current user's matches (onboarded, non-banned) to tag as current team members. */
export async function searchTeammates(query: string): Promise<TeamMember[]> {
  const search = orIlike(["full_name", "username"], query, { minLength: 2 });
  if (!search) return [];
  const uid = await getAuthUserId();
  if (!uid) return [];
  const matchIds = await getMatchIds(uid);
  if (matchIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url, gender")
    .eq("onboarding_completed", true)
    .eq("is_banned", false)
    .in("id", matchIds)
    .or(search)
    .limit(8);
  return ((data ?? []) as Array<{
    id: string;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
    gender: string | null;
  }>)
    .filter((p) => p.id !== uid)
    .map((p) => ({
      id: p.id,
      username: p.username,
      fullName: p.full_name,
      avatarUrl: resolveAvatarUrl(p.avatar_url, p.gender),
    }));
}

/** Create a post of `kind`. Self-write via the definer RPC. */
export async function createDiscoverPost(
  kind: PostMode,
  values: PostFormValues,
  teamMemberIds: string[] = []
): Promise<Result> {
  if (!isPostMode(kind)) return { ok: false, error: "Invalid post type." };
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const check = validatePostInput(kind, values);
  if (!check.ok)
    return { ok: false, error: `Please fill in: ${check.missing.join(", ")}.` };

  // Unchanged policy (20/hour) — creating an opportunity post is content that
  // fans out to other students' decks, so the quota and the fail-closed
  // posture both stay. Only the wording gets more precise.
  const gate = await checkRateLimitResult("smart_match_post", 20, 60 * 60);
  if (gate.status === "limited")
    return { ok: false, error: limitedMessage(gate, "Too many posts for now.") };
  if (gate.status === "error")
    return { ok: false, error: "Couldn’t save that right now — try again." };

  const ids = teamMemberIds.slice(0, 20);
  if (ids.length) {
    const matchIds = new Set(await getMatchIds(uid));
    if (ids.some((id) => !matchIds.has(id)))
      return {
        ok: false,
        error: "You can only tag people you've matched with.",
      };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_smart_match_post", {
    p_mode: kind,
    p_payload: buildPostPayload(kind, values),
    p_team_member_ids: ids,
  });
  if (error) return { ok: false, error: friendly(error.message) };

  await savePostPlace(kind, data as string | null, values);

  revalidatePath("/discover");
  revalidatePath("/discover/post");
  return { ok: true };
}

/**
 * Persist the picked place's id/x/y (from LocationPicker via `onPlace`, see
 * post-intent-fields.tsx) onto a just-created/updated post. Only Sports posts
 * carry a "place" field today. This never fails the outer create/update — the
 * post (and its text `place` label) is already saved by that point, so a pin
 * write failure is logged and swallowed rather than surfaced as a post error.
 */
async function savePostPlace(
  kind: PostMode,
  postId: string | null,
  values: PostFormValues
): Promise<void> {
  // Only Sports posts have a "place" field, and only when the author actually
  // touched LocationPicker (onPlace) does `place_id` show up on `values` at
  // all — untouched forms never call this RPC, on create or edit.
  if (kind !== "sports" || !postId || !("place_id" in values)) return;
  const placeId = typeof values.place_id === "string" ? values.place_id.trim() : "";
  // Empty string means the author cleared the pin — pass nulls through so
  // set_smart_match_post_place removes it rather than leaving a stale pin.
  const x = placeId ? Number(values.place_x) : null;
  const y = placeId ? Number(values.place_y) : null;
  if (placeId && (!Number.isFinite(x) || !Number.isFinite(y))) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_smart_match_post_place", {
    p_id: postId,
    p_place_id: placeId || null,
    p_x: x,
    p_y: y,
  });
  if (error) console.error("set_smart_match_post_place failed:", error.message);
}

/** Update one of the caller's own posts. */
export async function updateDiscoverPost(
  postId: string,
  kind: PostMode,
  values: PostFormValues,
  teamMemberIds: string[] | null = null
): Promise<Result> {
  if (!isPostMode(kind)) return { ok: false, error: "Invalid post type." };
  const check = validatePostInput(kind, values);
  if (!check.ok)
    return { ok: false, error: `Please fill in: ${check.missing.join(", ")}.` };
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const ids = teamMemberIds ? teamMemberIds.slice(0, 20) : null;
  if (ids && ids.length) {
    const { data: existing } = await supabase
      .from("smart_match_team_members")
      .select("user_id")
      .eq("post_id", postId);
    const existingIds = new Set(
      (existing ?? []).map((r) => (r as { user_id: string }).user_id)
    );
    const newlyAdded = ids.filter((id) => !existingIds.has(id));
    if (newlyAdded.length) {
      const matchIds = new Set(await getMatchIds(uid));
      if (newlyAdded.some((id) => !matchIds.has(id)))
        return {
          ok: false,
          error: "You can only tag people you've matched with.",
        };
    }
  }

  const { error } = await supabase.rpc("update_smart_match_post", {
    p_id: postId,
    p_payload: buildPostPayload(kind, values),
    p_team_member_ids: ids,
  });
  if (error) return { ok: false, error: friendly(error.message) };

  await savePostPlace(kind, postId, values);

  revalidatePath("/discover");
  revalidatePath("/discover/post");
  return { ok: true };
}

/** Close (soft) one of the caller's own posts. */
export async function closeDiscoverPost(postId: string): Promise<Result> {
  return setDiscoverPostStatus(postId, "closed");
}

/** Author-only lifecycle control: open / closed / filled. */
export async function setDiscoverPostStatus(
  postId: string,
  status: "open" | "closed" | "filled"
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_smart_match_post_status", {
    p_id: postId,
    p_status: status,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  revalidatePath("/discover/post");
  return { ok: true };
}

/**
 * Fill the post AND give the team a room (mig 0129). The RPC is idempotent on
 * post id, so a double-tap returns the same conversation rather than a second
 * one. Returns the community id, which is what /chat/c/[id] is keyed on.
 */
export async function createGroupFromDiscoverPost(
  postId: string,
  groupName: string
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_discover_group_chat", {
    p_post_id: postId,
    p_group_name: groupName,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  if (!data) return { ok: false, error: "Could not create the group chat." };
  revalidatePath("/discover");
  revalidatePath("/discover/post");
  revalidatePath("/chat");
  return { ok: true, conversationId: data as string };
}

/**
 * Delete a Discover team room (mig 0130). Owner-only, and the RPC refuses any
 * id that isn't a Discover group, so this can never reach a real community.
 * The post stays 'filled' — dropping the chat isn't re-opening the search.
 */
export async function deleteDiscoverGroupChat(
  communityId: string
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_discover_group_chat", {
    p_id: communityId,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/chat");
  return { ok: true };
}

/**
 * Leave a Discover team room — the non-owner's counterpart to deleting it
 * (fix-019). The membership row is the only thing removed; the room and its
 * history survive for everyone else. No migration was needed: the existing
 * "members leave communities" DELETE policy (mig 0119) already scopes this to
 * `user_id = auth.uid()` and explicitly refuses the owner, which is exactly the
 * rule this fix wants — the owner must delete the group instead.
 */
export async function leaveDiscoverGroupChat(
  communityId: string
): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const { data: community } = await supabase
    .from("communities")
    .select("owner_id")
    .eq("id", communityId)
    .single();
  if (community?.owner_id === uid)
    return {
      ok: false,
      error: "You created this group — delete it instead of leaving.",
    };

  const { error } = await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", uid);
  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath("/chat");
  revalidatePath(`/chat/c/${communityId}`);
  return { ok: true };
}

/** Delete one of the caller's own posts. RLS restricts this to author_id = me. */
export async function deleteDiscoverPost(postId: string): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("smart_match_posts")
    .delete()
    .eq("id", postId)
    .eq("author_id", uid);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  revalidatePath("/discover/post");
  return { ok: true };
}

/**
 * A right swipe on an intent card: request to join / apply / I'm in. Rate- and
 * block-guarded by the definer RPC. Returns the response id so the deck's Undo
 * window can cancel it.
 */
export async function respondToDiscoverPost(
  postId: string,
  message = ""
): Promise<{ ok: true; responseId: string | null } | { ok: false; error: string }> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  if (message && message.length > 500)
    return { ok: false, error: "Message is too long." };
  // Unchanged policy (40/hour) — responding to an opportunity notifies its
  // author, so it keeps its quota and its fail-closed posture.
  const gate = await checkRateLimitResult("smart_match_interest", 40, 60 * 60);
  if (gate.status === "limited")
    return { ok: false, error: limitedMessage(gate, "Too many requests for now.") };
  if (gate.status === "error")
    return { ok: false, error: "Couldn’t send that right now — try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("express_smart_match_interest", {
    p_post: postId,
    p_message: message?.trim() || null,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true, responseId: (data as string | null) ?? null };
}

/** A left swipe on an intent card: dismiss it for good (own-row write). */
export async function passDiscoverPost(postId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("pass_smart_match_post", {
    p_post: postId,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true };
}

/** Undo a left swipe — the intent-card twin of undoSwipe. */
export async function unpassDiscoverPost(postId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("unpass_smart_match_post", {
    p_post: postId,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  return { ok: true };
}

export async function cancelDiscoverResponse(
  responseId: string
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_smart_match_interest", {
    p_id: responseId,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  revalidatePath("/discover/post");
  return { ok: true };
}

async function respond(responseId: string, accept: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_smart_match_interest", {
    p_id: responseId,
    p_accept: accept,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  revalidatePath("/discover/post");
  return { ok: true };
}

export async function acceptDiscoverResponse(
  responseId: string
): Promise<Result> {
  return respond(responseId, true);
}

export async function declineDiscoverResponse(
  responseId: string
): Promise<Result> {
  return respond(responseId, false);
}

/** Save the viewer's own skill set (improves matching everywhere). */
export async function saveMySkills(skills: string[]): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ skills: normalizeSkills(skills, 30) })
    .eq("id", uid);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/discover");
  revalidatePath("/discover/post");
  return { ok: true };
}

/** Open (or create) the chat with an accepted match, then navigate to it. */
export async function openMatchChat(
  otherId: string
): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_conversation", {
    other_id: otherId,
  });
  if (error || !data) return { error: error?.message ?? "Could not open chat." };
  redirect(`/chat/${data as string}`);
}

/** Report a post for moderator review. */
export async function reportDiscoverPost(
  postId: string,
  reason: string
): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  // Unchanged policy (20/day) — reports create moderation work.
  const gate = await checkRateLimitResult("report", 20, 24 * 60 * 60);
  if (gate.status === "limited")
    return { ok: false, error: limitedMessage(gate, "Too many reports for now.") };
  if (gate.status === "error")
    return { ok: false, error: "Couldn’t file that report right now — try again." };
  const supabase = await createClient();
  const { error } = await supabase.from("reports").insert({
    reporter_id: uid,
    target_type: "smart_match_post",
    target_id: postId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Map raw RPC exceptions to friendly copy. */
function friendly(msg: string): string {
  if (msg.includes("already applied")) return "You already responded to this post.";
  if (msg.includes("recruitment posts require"))
    return "Only society officers or event organizers can recruit here.";
  if (msg.includes("closed")) return "This post is closed.";
  if (msg.includes("links must be https")) return "Links must start with https://.";
  if (msg.includes("blocked")) return "You can't do that.";
  return "Something went wrong. Please try again.";
}
