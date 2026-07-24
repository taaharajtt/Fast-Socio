"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import {
  isHelpCategory,
  urgencyFromToggle,
  type HelpCategory,
} from "@/lib/help/logic";

type Result = { ok: true } | { ok: false; error: string };

export type CreateHelpInput = {
  title: string;
  body: string;
  category: string;
  /** Single urgent toggle; mapped onto the urgency text column server-side. */
  isUrgent: boolean;
  isAnonymous?: boolean;
};

/**
 * Create a help request. Validation is duplicated in the DB (CHECK constraints +
 * create_help_request), but catching it here gives a friendly message instead of
 * a raw Postgres error. Redirects to the new request on success.
 */
export async function createHelpRequest(
  input: CreateHelpInput
): Promise<{ error: string } | void> {
  const uid = await getAuthUserId();
  if (!uid) return { error: "Not signed in." };

  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 4 || title.length > 120)
    return { error: "Title must be 4–120 characters." };
  if (body.length < 10 || body.length > 2000)
    return { error: "Describe what you need in a little more detail." };
  if (!isHelpCategory(input.category))
    return { error: "Pick a category." };
  const urgency = urgencyFromToggle(Boolean(input.isUrgent));

  const allowed = await checkRateLimit("create_help_request", 15, 24 * 60 * 60);
  if (!allowed)
    return { error: "You've posted a lot of requests today. Try again later." };

  // Semester/school/department/course are no longer collected on the form; they
  // are shown from the seeker's profile at read time (help_request_feed derives
  // author_school + author_semester). We pass nulls for the retained columns.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_help_request", {
    p_title: title,
    p_body: body,
    p_category: input.category as HelpCategory,
    p_urgency: urgency,
    p_department: null,
    p_semester: null,
    p_course_code: null,
    p_is_anonymous: Boolean(input.isAnonymous),
    p_allow_dms: true,
  });
  if (error) return { error: error.message };

  revalidatePath("/help");
  redirect(`/help/${data as string}`);
}

/** Edit an open request you own (owner + open enforced by the RPC). */
export async function updateHelpRequest(
  id: string,
  input: CreateHelpInput
): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 4 || title.length > 120)
    return { ok: false, error: "Title must be 4–120 characters." };
  if (body.length < 10 || body.length > 2000)
    return { ok: false, error: "Describe what you need in a little more detail." };
  if (!isHelpCategory(input.category))
    return { ok: false, error: "Pick a category." };
  const urgency = urgencyFromToggle(Boolean(input.isUrgent));

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_help_request", {
    p_id: id,
    p_title: title,
    p_body: body,
    p_category: input.category as HelpCategory,
    p_urgency: urgency,
    p_department: null,
    p_semester: null,
    p_course_code: null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/help/${id}`);
  revalidatePath("/help");
  return { ok: true };
}

/** Mark your (or, as admin, any) open request resolved. */
export async function resolveRequest(id: string): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_help_request", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/help/${id}`);
  revalidatePath("/help");
  return { ok: true };
}

/** Reopen a resolved request (owner/admin). */
export async function reopenRequest(id: string): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_help_request", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/help/${id}`);
  revalidatePath("/help");
  return { ok: true };
}

/**
 * Respond to a help request with a written answer. Optionally anonymous — the
 * helper's identity is then hidden from the seeker (shown as school + semester
 * only); the helper_id is preserved server-side for Aura/permissions.
 */
export async function respondToHelp(
  requestId: string,
  body: string,
  kind: "offer" | "answer",
  isAnonymous = false
): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const text = body.trim();
  if (kind === "answer" && text.length === 0)
    return { ok: false, error: "Write your response first." };
  if (text.length > 2000) return { ok: false, error: "That response is too long." };

  const allowed = await checkRateLimit("help_respond", 40, 60 * 60);
  if (!allowed) return { ok: false, error: "Too many responses for now." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_help", {
    p_request_id: requestId,
    p_body: text || null,
    p_kind: kind,
    p_is_anonymous: Boolean(isAnonymous),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/help/${requestId}`);
  revalidatePath("/help");
  return { ok: true };
}

/**
 * The seeker replies to one helper's response on their own request. Owner-only
 * (enforced in reply_to_help_response); only that helper (and the seeker/admin)
 * can read it back. Passing an empty body clears the reply.
 */
export async function replyToResponse(
  responseId: string,
  requestId: string,
  body: string
): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const text = body.trim();
  if (text.length > 1000) return { ok: false, error: "That reply is too long." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reply_to_help_response", {
    p_response_id: responseId,
    p_body: text || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/help/${requestId}`);
  return { ok: true };
}

/** Delete your own response (blocked once selected; admins may override). */
export async function deleteResponse(
  responseId: string,
  requestId: string
): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_help_response", { p_id: responseId });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/help/${requestId}`);
  return { ok: true };
}

/** Owner/admin selects the response that helped — resolves + thanks + Aura. */
export async function selectHelper(
  responseId: string,
  requestId: string
): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("select_help_helper", {
    p_response_id: responseId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/help/${requestId}`);
  revalidatePath("/help");
  return { ok: true };
}

/** Follow a request to get updates. Idempotent (self-only via RLS). */
export async function followRequest(requestId: string): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const allowed = await checkRateLimit("help_follow", 100, 60 * 60);
  if (!allowed) return { ok: false, error: "Slow down a moment." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("help_request_followers")
    .upsert(
      { request_id: requestId, user_id: uid },
      { onConflict: "request_id,user_id", ignoreDuplicates: true }
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/help/${requestId}`);
  return { ok: true };
}

/** Unfollow a request. */
export async function unfollowRequest(requestId: string): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("help_request_followers")
    .delete()
    .eq("request_id", requestId)
    .eq("user_id", uid);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/help/${requestId}`);
  return { ok: true };
}

/**
 * Report a help request or response into the shared moderation queue
 * (target_type 'help_request' / 'help_response'; surfaced at /admin/reports).
 */
export async function reportHelp(
  targetType: "help_request" | "help_response",
  targetId: string,
  reason: string,
  details?: string
): Promise<Result> {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const allowed = await checkRateLimit(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Too many reports for now." };

  const supabase = await createClient();
  const { error } = await supabase.from("reports").insert({
    reporter_id: uid,
    target_type: targetType,
    target_id: targetId,
    reason,
    details: details ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
