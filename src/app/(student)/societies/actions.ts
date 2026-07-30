"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isAppStorageUrl } from "@/lib/url-safety";
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
 * Post an announcement from the chat-style composer (fix-049).
 *
 * Body-only — no title. `society_announcements.title` became nullable in mig
 * 0147 precisely so a one-field composer could write a row without inventing a
 * title nobody typed. Who may post is unchanged: the RPC is officer/admin gated.
 */
export async function postSocietyAnnouncement(
  societyId: string,
  body: string,
  opts?: { attachmentPath?: string }
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
    const slash = opts.attachmentPath.lastIndexOf("/");
    const { data: objects } = await supabase.storage
      .from("chat-media")
      .list(opts.attachmentPath.slice(0, slash), {
        search: opts.attachmentPath.slice(slash + 1),
        limit: 1,
      });
    const mime = (objects?.[0]?.metadata as { mimetype?: string } | undefined)
      ?.mimetype;
    if (!mime || !mime.startsWith("image/"))
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
  const q = query.trim();
  if (q.length < 2) return [];
  const safe = q.replace(/[,()*%\\]/g, " ").trim();
  if (!safe) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url, gender")
    .eq("onboarding_completed", true)
    .eq("is_banned", false)
    .or(`full_name.ilike.%${safe}%,username.ilike.%${safe}%`)
    .limit(8);
  return (data as StudentHit[]) ?? [];
}
