"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { checkRateLimit } from "@/lib/rate-limit";
import { isPostMode, type PostMode } from "@/lib/smart-match/modes";
import {
  buildSwipeDeck,
  INTENT_KINDS,
  type DiscoverSwipeCard,
} from "@/lib/discover/cards";
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

/** The viewer facts scoring needs from their own profile. Server-only. */
async function getDiscoverViewer(): Promise<SmartMatchViewer | null> {
  const uid = await getAuthUserId();
  if (!uid) return null;
  const supabase = await createClient();
  const { data: prof } = await supabase
    .from("profiles")
    .select("username, department, graduation_year, interests, skills, semester")
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
  };
}

type PostRow = {
  id: string;
  mode: string;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
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
  scheduled_at: string | null;
  hackathon_name: string | null;
  hackathon_url: string | null;
  meeting_preference: string | null;
  preferred_commitment: string | null;
  skill_level: string | null;
  availability: string | null;
  portfolio_url: string | null;
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
  }>;
  return {
    id: r.id,
    mode: r.mode as PostMode,
    authorId: r.author_id,
    authorName: r.author_name,
    authorAvatar: r.author_avatar,
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
    scheduledAt: r.scheduled_at,
    hackathonName: r.hackathon_name,
    hackathonUrl: r.hackathon_url,
    meetingPreference: r.meeting_preference,
    preferredCommitment: r.preferred_commitment,
    skillLevel: r.skill_level,
    availability: r.availability,
    portfolioUrl: r.portfolio_url,
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
      avatarUrl: t.avatar_url,
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
 * One page of open intent posts, newest first. `cursor` is the created_at of
 * the last row already in the deck. Scoring/interleaving is pure TS in
 * lib/discover/cards.ts.
 */
export async function getDiscoverIntents({
  cursor = null,
  limit = 40,
}: {
  cursor?: string | null;
  limit?: number;
} = {}): Promise<SmartMatchPost[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_unified_discover_feed", {
    p_modes: [...INTENT_KINDS],
    p_limit: Math.max(1, Math.min(limit, 80)),
    p_before: cursor,
  });
  return ((data as PostRow[]) ?? []).map(mapPost);
}

/** SOCIO swipe candidates. Preserves the original deck behaviour verbatim. */
export async function getSocioSwipeCandidates(
  limit = 20
): Promise<DiscoverProfile[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_discover_candidates", {
    p_limit: limit,
  });
  return (data as DiscoverProfile[]) ?? [];
}

/**
 * The whole Discover deck as ONE normalized, pre-interleaved list: SOCIO people
 * and open intent posts, ranked and mixed. This is what the swipe deck renders
 * and what it calls to top itself up.
 */
export async function getDiscoverSwipeDeck({
  cursor = null,
  socioLimit = 20,
  intentLimit = 40,
}: {
  cursor?: string | null;
  socioLimit?: number;
  intentLimit?: number;
} = {}): Promise<DiscoverSwipeCard[]> {
  const uid = await getAuthUserId();
  if (!uid) return [];
  const viewer = await getDiscoverViewer();
  if (!viewer) return [];

  const [socio, posts] = await Promise.all([
    getSocioSwipeCandidates(socioLimit),
    getDiscoverIntents({ cursor, limit: intentLimit }),
  ]);

  return buildSwipeDeck({ socio, posts, viewer, viewerId: uid });
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
      .select("full_name, username, avatar_url, department, graduation_year, verified, aura_score")
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
          .select("id, full_name, username, avatar_url")
          .in("id", memberIds)
      : { data: [] as unknown[] };
    const byId = new Map(
      (memberProfiles ?? []).map((p) => {
        const m = p as {
          id: string;
          full_name: string | null;
          username: string | null;
          avatar_url: string | null;
        };
        return [
          m.id,
          {
            id: m.id,
            username: m.username,
            fullName: m.full_name,
            avatarUrl: m.avatar_url,
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
          .select("id, full_name, username, avatar_url")
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
          applicantAvatar: p?.avatar_url ?? null,
        };
      });
  }

  const myPosts: MyIntent[] = myFullPosts.map((p) => ({
    ...p,
    pendingCount: pendingByPost.get(p.id) ?? 0,
  }));

  return {
    viewer,
    myPosts,
    incoming,
    recruitAnchors: await getRecruitAnchors(uid),
  };
}

/** Search onboarded, non-banned students to tag as current team members. */
export async function searchTeammates(query: string): Promise<TeamMember[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const safe = q.replace(/[,()*%\\]/g, " ").trim();
  if (!safe) return [];
  const uid = await getAuthUserId();
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .eq("onboarding_completed", true)
    .eq("is_banned", false)
    .or(`full_name.ilike.%${safe}%,username.ilike.%${safe}%`)
    .limit(8);
  return ((data ?? []) as Array<{
    id: string;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
  }>)
    .filter((p) => p.id !== uid)
    .map((p) => ({
      id: p.id,
      username: p.username,
      fullName: p.full_name,
      avatarUrl: p.avatar_url,
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

  const allowed = await checkRateLimit("smart_match_post", 20, 60 * 60);
  if (!allowed) return { ok: false, error: "Too many posts for now." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_smart_match_post", {
    p_mode: kind,
    p_payload: buildPostPayload(kind, values),
    p_team_member_ids: teamMemberIds.slice(0, 20),
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  return { ok: true };
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
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_smart_match_post", {
    p_id: postId,
    p_payload: buildPostPayload(kind, values),
    p_team_member_ids: teamMemberIds ? teamMemberIds.slice(0, 20) : null,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
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
  const allowed = await checkRateLimit("smart_match_interest", 40, 60 * 60);
  if (!allowed) return { ok: false, error: "Too many requests for now." };
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
  const allowed = await checkRateLimit("report", 20, 24 * 60 * 60);
  if (!allowed) return { ok: false, error: "Too many reports for now." };
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
