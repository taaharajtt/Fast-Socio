"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isAppStorageUrl } from "@/lib/url-safety";

/** Submit a new community for admin approval (status starts pending). */
export async function createCommunity(input: {
  name: string;
  description: string;
  coverUrl?: string | null;
}): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = input.name.trim();
  if (name.length < 2 || name.length > 60)
    return { error: "Name must be 2–60 characters." };
  // Only accept covers we host (mirrors the post-image guard).
  if (input.coverUrl && !isAppStorageUrl(input.coverUrl))
    return { error: "Invalid cover image." };

  // Cap submissions to curb spam even though approval is manual.
  const allowed = await checkRateLimit("create_community", 5, 24 * 60 * 60);
  if (!allowed) return { error: "You've submitted too many communities today." };

  const { data, error } = await supabase
    .from("communities")
    .insert({
      owner_id: user.id,
      name,
      description: input.description.trim() || null,
      cover_url: input.coverUrl ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  redirect(`/communities/${data.id}`);
}

/**
 * Owner-only metadata edit (UAT-020): name, description, and 16:9 cover photo.
 * RLS ("owners edit their community") is the real guard; we scope by owner_id
 * as well. Status is protected by a trigger and untouched here.
 */
export async function updateCommunity(input: {
  id: string;
  name: string;
  description: string;
  coverUrl?: string | null;
}): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = input.name.trim();
  if (name.length < 2 || name.length > 60)
    return { error: "Name must be 2–60 characters." };
  if (input.coverUrl && !isAppStorageUrl(input.coverUrl))
    return { error: "Invalid cover image." };

  const { error } = await supabase
    .from("communities")
    .update({
      name,
      description: input.description.trim() || null,
      cover_url: input.coverUrl ?? null,
    })
    .eq("id", input.id)
    .eq("owner_id", user.id);
  if (error) return { error: error.message };

  revalidatePath(`/communities/${input.id}`);
  redirect(`/communities/${input.id}`);
}

/** Send a message to a community's open chat room (Zone 2). RLS enforces membership. */
export async function sendCommunityMessage(
  communityId: string,
  body: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const text = body.trim();
  if (text.length < 1 || text.length > 2000)
    return { ok: false, error: "Message must be 1–2000 characters." };

  const allowed = await checkRateLimit("community_chat", 60, 60);
  if (!allowed) return { ok: false, error: "You're sending too fast." };

  const { error } = await supabase.from("community_chat_messages").insert({
    community_id: communityId,
    sender_id: user.id,
    body: text,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Approve or reject a pending community post (Zone 1). The RPC verifies the
 * caller owns/moderates the community and notifies the post author.
 */
export async function moderateCommunityPost(
  postId: string,
  approve: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("moderate_community_post", {
    p_post_id: postId,
    p_approve: approve,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/communities");
  return { ok: true };
}

export async function joinCommunity(communityId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("community_members")
    .insert({ community_id: communityId, user_id: user.id, role: "member" });
  revalidatePath(`/communities/${communityId}`);
}

export async function leaveCommunity(communityId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", user.id);
  revalidatePath(`/communities/${communityId}`);
}

/** Report a community (target_type = 'community'), feeds /admin/reports?type=community. */
export async function reportCommunity(
  communityId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const allowed = await checkRateLimit(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Too many reports for now." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: "community",
    target_id: communityId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
