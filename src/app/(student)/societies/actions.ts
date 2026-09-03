"use server";

import { revalidatePath } from "next/cache";
import { headObject } from "@/lib/s3/sign";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isAppStorageUrl } from "@/lib/url-safety";
import { orIlike } from "@/lib/postgrest/search";
import {
  isSocietyCategory,
  isOfficerRole,
  type SocietyOfficerRole,
} from "@/lib/societies/logic";
import {
  followCommunity,
  unfollowCommunity,
} from "@/app/(student)/communities/actions";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Follow a society = spectate it. Since mig 0119 this is community_followers,
 * NOT community_members: following gets you the broadcast feed and its
 * notifications, while sending a message in the general chat requires a
 * separate, approved JOIN (see requestJoinCommunity). Societies and casual
 * chat rooms share one implementation — a society is just a community.
 */
export async function followSociety(societyId: string): Promise<void> {
  return followCommunity(societyId);
}

export async function unfollowSociety(societyId: string): Promise<void> {
  return unfollowCommunity(societyId);
}

export type SocietyProfileInput = {
  category: string;
  description?: string | null;
  recruitmentOpen?: boolean | null;
  contactEmail?: string | null;
  instagramUrl?: string | null;
  websiteUrl?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
};

/** Neutralize obvious junk in a user-supplied external URL (stored, not fetched). */
function cleanUrl(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return `https://${s}`;
  return s.slice(0, 300);
}

/**
 * Register a community as a society and/or edit its society profile. Delegates
 * to upsert_society_profile() which flips is_society on and enforces
 * officer/owner/admin authority server-side. Never touches status / verified.
 */
export async function upsertSocietyProfile(
  societyId: string,
  input: SocietyProfileInput
): Promise<Result> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  if (!isSocietyCategory(input.category))
    return { ok: false, error: "Pick a valid category." };
  // Only accept images we host (mirrors the community/event cover guard).
  if (input.avatarUrl && !isAppStorageUrl(input.avatarUrl))
    return { ok: false, error: "Invalid logo image." };
  if (input.coverUrl && !isAppStorageUrl(input.coverUrl))
    return { ok: false, error: "Invalid cover image." };

  const { error } = await supabase.rpc("upsert_society_profile", {
    p_society: societyId,
    p_society_category: input.category,
    p_description:
      input.description === undefined ? null : input.description?.trim() || null,
    p_recruitment_open: input.recruitmentOpen ?? null,
    p_contact_email: input.contactEmail?.trim() || null,
    p_instagram_url: cleanUrl(input.instagramUrl),
    p_website_url: cleanUrl(input.websiteUrl),
    p_avatar_url: input.avatarUrl ?? null,
    p_cover_url: input.coverUrl ?? null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/societies/${societyId}`);
  revalidatePath("/communities");
  return { ok: true };
}

/** Assign (or change) an officer role. Rank checks live in the RPC. */
export async function assignSocietyRole(
  societyId: string,
  userId: string,
  role: SocietyOfficerRole,
  title?: string | null
): Promise<Result> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  if (!isOfficerRole(role)) return { ok: false, error: "Invalid role." };

  const { error } = await supabase.rpc("assign_society_role", {
    p_society: societyId,
    p_user: userId,
    p_role: role,
    p_title: title?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/societies/${societyId}`);
  return { ok: true };
}

export async function removeSocietyRole(
  societyId: string,
  userId: string
): Promise<Result> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("remove_society_role", {
    p_society: societyId,
    p_user: userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/societies/${societyId}`);
  return { ok: true };
}

/** Post a society announcement (officer/owner/admin; enforced by the RPC). */
export async function createSocietyAnnouncement(
  societyId: string,
  title: string,
  body: string,
  visibility: "public" | "members"
): Promise<Result> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const t = title.trim();
  const b = body.trim();
  if (t.length < 2 || t.length > 120)
    return { ok: false, error: "Title must be 2–120 characters." };
  if (b.length < 1 || b.length > 4000)
    return { ok: false, error: "Write something to announce." };

  const allowed = await checkRateLimit("society_announce", 20, 24 * 60 * 60);
  if (!allowed) return { ok: false, error: "Too many announcements today." };

  const { error } = await supabase.rpc("create_society_announcement", {
    p_society: societyId,
    p_title: t,
    p_body: b,
    p_visibility: visibility,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/societies/${societyId}`);
  return { ok: true };
}

/**
 * Post into the society's broadcast channel (fix-049, reshaped by UAT-04).
 *
 * Body-only — no title. `society_announcements.title` became nullable in mig
 * 0147 precisely so a one-field composer could write a row without inventing a
 * title nobody typed.
 *
 * WHO MAY POST CHANGED. This used to be officer/admin only, and the surface was
 * a one-way notice board. UAT-04 makes it a role-aware SHARED channel: an
 * ordinary member may post, reply and post anonymously; officers keep every
 * power they had on top of that. The rule lives in `society_capabilities`
 * (mig 0178) and is enforced by the RPC — this action does not re-implement it,
 * because two copies of an authorization rule is one copy too many.
 */
export async function postSocietyAnnouncement(
  societyId: string,
  body: string,
  opts?: {
    attachmentPath?: string;
    /** UAT-04: post without your name attached. Masked by the feed view. */
    anonymous?: boolean;
    /** The announcement this one replies to; must be in the same channel. */
    replyTo?: string | null;
  }
): Promise<Result> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const b = body.trim();
  if (!b && !opts?.attachmentPath)
    return { ok: false, error: "Write something to announce." };
  if (b.length > 4000) return { ok: false, error: "That's too long." };

  if (opts?.attachmentPath) {
    // Same rule as community chat: images only, checked against what storage
    // actually holds rather than trusting the picker.
    if (!opts.attachmentPath.startsWith(`${societyId}/`) ||
        opts.attachmentPath.includes("..")) {
      return { ok: false, error: "Invalid attachment." };
    }
    const head = await headObject("chat-media", opts.attachmentPath);
    if (!head?.contentType?.startsWith("image/"))
      return { ok: false, error: "Only images can be attached." };
  }

  const allowed = await checkRateLimit("society_announce", 20, 24 * 60 * 60);
  if (!allowed) return { ok: false, error: "Too many announcements today." };

  const { error } = await supabase.rpc("post_society_announcement", {
    p_society: societyId,
    p_body: b,
    p_visibility: "public",
    p_attachment_url: opts?.attachmentPath ?? null,
    p_attachment_type: opts?.attachmentPath ? "image" : null,
    // UAT-04: members may speak here, and may do so anonymously. `=== true`
    // rather than a truthy check for the same reason the feed composer uses
    // one — anonymity must never be conferred by a value merely being present.
    p_is_anonymous: opts?.anonymous === true,
    p_reply_to: opts?.replyTo ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/societies/${societyId}`);
  return { ok: true };
}

/** Post a poll into the announcement thread (fix-049). */
export async function postSocietyAnnouncementPoll(
  societyId: string,
  question: string,
  options: string[]
): Promise<Result> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const q = question.trim();
  const opts = options.map((o) => o.trim()).filter(Boolean);
  if (q.length < 1 || q.length > 300)
    return { ok: false, error: "Ask a question (1–300 characters)." };
  if (opts.length < 2 || opts.length > 6)
    return { ok: false, error: "A poll needs 2–6 options." };

  const allowed = await checkRateLimit("society_announce", 20, 24 * 60 * 60);
  if (!allowed) return { ok: false, error: "Too many announcements today." };

  const { error } = await supabase.rpc("post_society_announcement_poll", {
    p_society: societyId,
    p_question: q,
    p_options: opts,
    p_visibility: "public",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/societies/${societyId}`);
  return { ok: true };
}

/**
 * Edit one of the caller's own broadcasts (mig 0179).
 *
 * THE AUTHOR ONLY — including the author of an anonymous broadcast, who the
 * RPC matches on the real column rather than the masked feed view. An officer
 * may DELETE a broadcast but may never rewrite one: putting words in a
 * member's mouth, under their name, is not a moderation power, and the RPC
 * refuses it regardless of rank.
 */
export async function editSocietyAnnouncement(
  societyId: string,
  announcementId: string,
  body: string
): Promise<Result> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const text = body.trim();
  if (text.length < 1 || text.length > 4000)
    return { ok: false, error: "Message must be 1–4000 characters." };

  const { error } = await supabase.rpc("edit_society_announcement", {
    p_announcement: announcementId,
    p_body: text,
  });
  if (error) return { ok: false, error: "Only your own broadcasts can be edited." };
  revalidatePath(`/societies/${societyId}`);
  return { ok: true };
}

export async function pinSocietyAnnouncement(
  societyId: string,
  announcementId: string,
  pinned: boolean
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_society_announcement_pin", {
    p_announcement: announcementId,
    p_pinned: pinned,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/societies/${societyId}`);
  return { ok: true };
}

export async function deleteSocietyAnnouncement(
  societyId: string,
  announcementId: string
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_society_announcement", {
    p_announcement: announcementId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/societies/${societyId}`);
  return { ok: true };
}

/**
 * Report one broadcast message for moderator review.
 *
 * `society_announcement` has been a report target since mig 0103; nothing in
 * the app filed one until the channel became a place ordinary members speak.
 * An anonymous broadcast is reportable like any other — the report carries the
 * message id, and a moderator resolves the author through the same definer
 * path a president would, never through the reporter.
 */
export async function reportSocietyAnnouncement(
  announcementId: string,
  reason: string
): Promise<Result> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const allowed = await checkRateLimit(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Too many reports for now." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: uid,
    target_type: "society_announcement",
    target_id: announcementId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Report a society (target_type = 'society'), feeds /admin/reports?type=society. */
export async function reportSociety(
  societyId: string,
  reason: string
): Promise<Result> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const allowed = await checkRateLimit(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Too many reports for now." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: uid,
    target_type: "society",
    target_id: societyId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type StudentHit = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  gender: string | null;
};

/** Search onboarded students to appoint as officers (name or roll number). */
export async function searchStudents(query: string): Promise<StudentHit[]> {
  const search = orIlike(["full_name", "username"], query, { minLength: 2 });
  if (!search) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url, gender")
    .eq("onboarding_completed", true)
    .eq("is_banned", false)
    .or(search)
    .limit(8);
  return (data as StudentHit[]) ?? [];
}


/**
 * The viewer's capabilities in a society, straight from the database (UAT-04).
 *
 * The UI reads this to decide what to RENDER. It is deliberately NOT the
 * authorization boundary: every privileged RPC re-checks the caller's rank, so
 * a stale or forged capability set buys nothing but a button that fails.
 */
export type SocietyCapabilities = {
  rank: number;
  is_admin: boolean;
  can_post: boolean;
  can_react: boolean;
  can_reply: boolean;
  can_post_anonymously: boolean;
  can_moderate_members: boolean;
  can_reveal_anonymous: boolean;
  can_manage_events: boolean;
  can_assign_moderator: boolean;
  can_assign_officers: boolean;
  can_remove_members: boolean;
};

const NO_CAPABILITIES: SocietyCapabilities = {
  rank: 0,
  is_admin: false,
  can_post: false,
  can_react: false,
  can_reply: false,
  can_post_anonymously: false,
  can_moderate_members: false,
  can_reveal_anonymous: false,
  can_manage_events: false,
  can_assign_moderator: false,
  can_assign_officers: false,
  can_remove_members: false,
};

export async function getSocietyCapabilities(
  societyId: string
): Promise<SocietyCapabilities> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return NO_CAPABILITIES;
  const { data, error } = await supabase.rpc("society_capabilities", {
    p_society: societyId,
  });
  // Fail CLOSED. A capability read that errors must not be mistaken for "you
  // may do everything"; the worst case is a hidden button, not a granted power.
  if (error || !data) return NO_CAPABILITIES;
  return { ...NO_CAPABILITIES, ...(data as Partial<SocietyCapabilities>) };
}

/** Toggle the caller's reaction on a broadcast message (UAT-04). */
export async function toggleBroadcastReaction(
  announcementId: string,
  emoji: string
): Promise<{ ok: true; reacted: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  if (emoji.length < 1 || emoji.length > 8)
    return { ok: false, error: "That reaction isn’t supported." };

  const { data, error } = await supabase.rpc("toggle_announcement_reaction", {
    p_id: announcementId,
    p_emoji: emoji,
  });
  if (error) return { ok: false, error: "Couldn’t react to that message." };
  return { ok: true, reacted: data === true };
}

/**
 * Reveal the author of an anonymous broadcast — president, owner or admin only
 * (UAT-04).
 *
 * The masking itself happens in `society_announcement_feed`, so an ordinary
 * member never receives the identity in the first place and no realtime payload
 * can leak it. This is the deliberate, explicit act of looking, and it is
 * refused in the database for anyone below president rank.
 */
export async function revealBroadcastAuthor(
  announcementId: string
): Promise<
  | { ok: true; author: { id: string; name: string | null; username: string | null } }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase.rpc("reveal_announcement_author", {
    p_id: announcementId,
  });
  const row = (data as { author_id: string; full_name: string | null; username: string | null }[] | null)?.[0];
  if (error || !row)
    return {
      ok: false,
      error: "Only the president or the owner can reveal an anonymous author.",
    };

  return {
    ok: true,
    author: { id: row.author_id, name: row.full_name, username: row.username },
  };
}
