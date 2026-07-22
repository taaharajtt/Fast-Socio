"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  isPostMode,
  type PostMode,
} from "@/lib/smart-match/modes";
import {
  buildPostPayload,
  validatePostInput,
  normalizeSkills,
  type PostFormValues,
} from "@/lib/smart-match/validate";
import type {
  DiscoverModeData,
  IncomingApplication,
  MyPost,
  RecruitAnchor,
  SmartMatchPost,
  SmartMatchViewer,
  TeamMember,
} from "@/lib/smart-match/types";

type Result = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Server actions for the five focused post modes. SOCIO (the swipe deck) keeps
// using discover/actions.ts + get_discover_candidates untouched. Every cross-
// user read of other people's posts goes exclusively through the
// get_smart_match_posts SECURITY DEFINER RPC; writes go through the definer
// create/respond RPCs (mig 0105).
// ---------------------------------------------------------------------------

/** The viewer facts scoring needs from their own profile. Server-only. */
async function getSmartMatchViewer(): Promise<SmartMatchViewer | null> {
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
  deadline: string | null;
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
    deadline: r.deadline,
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

/** Eligible open posts in `mode` (unscored — scored client-side in TS). */
export async function getSmartMatchPosts(
  mode: PostMode,
  limit = 40
): Promise<SmartMatchPost[]> {
  if (!isPostMode(mode)) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_smart_match_posts", {
    p_mode: mode,
    p_limit: limit,
  });
  return ((data as PostRow[]) ?? []).map(mapPost);
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

/** Everything the secondary board needs for one mode. */
export async function getDiscoverModeData(
  mode: PostMode
): Promise<DiscoverModeData | null> {
  if (!isPostMode(mode)) return null;
  const uid = await getAuthUserId();
  if (!uid) return null;
  const viewer = await getSmartMatchViewer();
  if (!viewer) return null;
  const supabase = await createClient();

  const [posts, { data: mine }] = await Promise.all([
    getSmartMatchPosts(mode, 40),
    supabase
      .from("smart_match_posts")
      .select("id, mode, title, status, people_needed, created_at")
      .eq("author_id", uid)
      .eq("mode", mode)
      .order("created_at", { ascending: false }),
  ]);

  const myRows = (mine ?? []) as Array<{
    id: string;
    mode: string;
    title: string;
    status: "open" | "closed";
    people_needed: number | null;
    created_at: string;
  }>;
  const myPostIds = myRows.map((r) => r.id);

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
    const titleById = new Map(myRows.map((r) => [r.id, r.title]));
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

  const myPosts: MyPost[] = myRows.map((r) => ({
    id: r.id,
    mode: r.mode as PostMode,
    title: r.title,
    status: r.status,
    peopleNeeded: r.people_needed,
    createdAt: r.created_at,
    pendingCount: pendingByPost.get(r.id) ?? 0,
  }));

  const recruitAnchors =
    mode === "recruitment" ? await getRecruitAnchors(uid) : [];

  return { viewer, posts, myPosts, incoming, recruitAnchors };
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

/** Create a post for a mode. Self-write via the definer RPC. */
export async function createSmartMatchPost(
  mode: PostMode,
  values: PostFormValues,
  teamMemberIds: string[] = []
): Promise<Result> {
  if (!isPostMode(mode)) return { ok: false, error: "Invalid mode." };
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const check = validatePostInput(mode, values);
  if (!check.ok)
    return { ok: false, error: `Please fill in: ${check.missing.join(", ")}.` };

  const allowed = await checkRateLimit("smart_match_post", 20, 60 * 60);
  if (!allowed) return { ok: false, error: "Too many posts for now." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_smart_match_post", {
    p_mode: mode,
    p_payload: buildPostPayload(mode, values),
    p_team_member_ids: teamMemberIds.slice(0, 20),
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  return { ok: true };
}

/** Update one of the caller's own posts. */
export async function updateSmartMatchPost(
  id: string,
  mode: PostMode,
  values: PostFormValues,
  teamMemberIds: string[] | null = null
): Promise<Result> {
  if (!isPostMode(mode)) return { ok: false, error: "Invalid mode." };
  const check = validatePostInput(mode, values);
  if (!check.ok)
    return { ok: false, error: `Please fill in: ${check.missing.join(", ")}.` };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_smart_match_post", {
    p_id: id,
    p_payload: buildPostPayload(mode, values),
    p_team_member_ids: teamMemberIds ? teamMemberIds.slice(0, 20) : null,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  return { ok: true };
}

/** Close (soft) one of the caller's own posts. */
export async function closeSmartMatchPost(id: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_smart_match_post", { p_id: id });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  return { ok: true };
}

/** Express interest / request to join a post. Rate-limited + block-guarded. */
export async function expressInterest(
  postId: string,
  message: string
): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  if (message && message.length > 500)
    return { ok: false, error: "Message is too long." };
  const allowed = await checkRateLimit("smart_match_interest", 40, 60 * 60);
  if (!allowed) return { ok: false, error: "Too many requests for now." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("express_smart_match_interest", {
    p_post: postId,
    p_message: message?.trim() || null,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  return { ok: true };
}

export async function cancelInterest(applicationId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_smart_match_interest", {
    p_id: applicationId,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  return { ok: true };
}

async function respond(applicationId: string, accept: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_smart_match_interest", {
    p_id: applicationId,
    p_accept: accept,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  revalidatePath("/discover");
  return { ok: true };
}

export async function acceptInterest(applicationId: string): Promise<Result> {
  return respond(applicationId, true);
}

export async function declineInterest(applicationId: string): Promise<Result> {
  return respond(applicationId, false);
}

/** Save the viewer's own skill set (improves matching). */
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
export async function reportSmartMatchPost(
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
  if (msg.includes("already applied")) return "You already applied to this post.";
  if (msg.includes("recruitment posts require"))
    return "Only society officers or event organizers can recruit here.";
  if (msg.includes("closed")) return "This post is closed.";
  if (msg.includes("links must be https")) return "Links must start with https://.";
  if (msg.includes("blocked")) return "You can't do that.";
  return "Something went wrong. Please try again.";
}
