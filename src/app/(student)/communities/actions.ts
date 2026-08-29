"use server";

import { revalidatePath } from "next/cache";
import { headObject } from "@/lib/s3/sign";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isAppStorageUrl } from "@/lib/url-safety";
import { isSocietyCategory } from "@/lib/societies/logic";

/**
 * Submit a new community for admin approval (status starts pending). The
 * creation modal's "Verified Community/Society" option sets isSociety so the
 * row is born with is_society = true and a category — still reviewed by an
 * admin like any other community, just pre-registered as a society rather
 * than requiring a separate upsertSocietyProfile step after approval.
 */
export async function createCommunity(input: {
  name: string;
  description: string;
  coverUrl?: string | null;
  isSociety?: boolean;
  societyCategory?: string | null;
}): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { error: "Not signed in." };

  const name = input.name.trim();
  if (name.length < 2 || name.length > 60)
    return { error: "Name must be 2–60 characters." };
  // Only accept covers we host (mirrors the post-image guard).
  if (input.coverUrl && !isAppStorageUrl(input.coverUrl))
    return { error: "Invalid cover image." };
  if (input.isSociety && !isSocietyCategory(input.societyCategory))
    return { error: "Pick a category for your society." };

  // Cap submissions to curb spam even though approval is manual.
  const allowed = await checkRateLimit("create_community", 5, 24 * 60 * 60);
  if (!allowed) return { error: "You've submitted too many communities today." };

  const { data, error } = await supabase
    .from("communities")
    .insert({
      owner_id: userId,
      name,
      description: input.description.trim() || null,
      cover_url: input.coverUrl ?? null,
      status: "pending",
      is_society: input.isSociety ?? false,
      society_category: input.isSociety ? input.societyCategory : null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  redirect(
    input.isSociety ? `/societies/${data.id}` : `/communities/${data.id}`
  );
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
  const userId = await getAuthUserId();
  if (!userId) return { error: "Not signed in." };

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
    .eq("owner_id", userId);
  if (error) return { error: error.message };

  revalidatePath(`/communities/${input.id}`);
  redirect(`/communities/${input.id}`);
}

/**
 * Send a message to a community's open chat room (Zone 2). Goes through the
 * send_community_message RPC rather than a direct insert so `is_anonymous` is
 * set under definer rights — a plain client insert can only ever write the
 * column's `false` default (UAT-005).
 */
export async function sendCommunityMessage(
  communityId: string,
  body: string,
  anonymous = false
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const text = body.trim();
  if (text.length < 1 || text.length > 2000)
    return { ok: false, error: "Message must be 1–2000 characters." };

  // No send throttle on chat (see the note in (student)/chat/actions.ts): the
  // limiter fails closed, so any failure to consult it rejected an ordinary
  // message as "You're sending too fast". Membership is still enforced by RLS.

  const { error } = await supabase.rpc("send_community_message", {
    p_community_id: communityId,
    p_body: text,
    p_anonymous: anonymous,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Attach an image to a community / chat-room / Discover-room message (fix-052).
 *
 * Images only, enforced in three independent places so no single bypass is
 * enough: the picker's `accept`, the real MIME check below, and a DB CHECK that
 * only permits `attachment_type = 'image'` (migration 0142).
 *
 * `path` is an already-uploaded object in the private `chat-media` bucket. It
 * goes in as a raw storage path, never a URL — the reader signs it at display
 * time, the same way the DM thread does.
 *
 * Inserted directly rather than through `send_community_message`, because that
 * RPC has no attachment parameter. RLS still governs the write: the INSERT
 * policy requires `sender_id = auth.uid()` AND membership of the community.
 */
export async function sendCommunityImage(
  communityId: string,
  path: string,
  anonymous = false
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  // The path must live under this community's folder — otherwise a caller could
  // point a message at an object belonging to a room they aren't in.
  if (!path.startsWith(`${communityId}/`) || path.includes("..")) {
    return { ok: false, error: "Invalid attachment." };
  }

  // No send throttle on chat (see the note in (student)/chat/actions.ts): the
  // limiter fails closed, so any failure to consult it rejected an ordinary
  // message as "You're sending too fast". Membership is still enforced by RLS.

  // Server-side MIME check. The accept attribute is a convenience; this asks
  // storage what the object actually is. It matters more now than it did on
  // Supabase: the presigned PUT carried the content type the CLIENT declared,
  // so this is the first point at which the real bytes are inspected.
  const head = await headObject("chat-media", path);
  if (!head?.contentType?.startsWith("image/")) {
    return { ok: false, error: "Only images can be attached." };
  }

  const { error } = await supabase.from("community_chat_messages").insert({
    community_id: communityId,
    sender_id: userId,
    body: "",
    attachment_url: path,
    attachment_type: "image",
    is_anonymous: anonymous,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Delete a message in a community / chat room / Discover room (fix-051).
 *
 * Authorization is NOT decided here: `delete_community_message` is SECURITY
 * INVOKER, so the RLS policy added in migration 0142 is the gate — the author,
 * the community owner, a moderator, a society officer or an admin. Everyone
 * else matches zero rows and the RPC raises. The policy's WITH CHECK also means
 * this path can only ever produce a tombstone, never an edit.
 */
export async function deleteCommunityMessage(
  messageId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("delete_community_message", {
    p_message_id: messageId,
  });
  if (error) {
    return {
      ok: false,
      error:
        error.message.includes("not authorized")
          ? "You can't delete this message."
          : error.message,
    };
  }
  return { ok: true };
}

/**
 * Stamp the caller's read position in a community's chat room (mirrors
 * markConversationRead for DMs). Called when the room is opened and again as
 * new messages arrive while it's open, so the room never shows stale unread
 * state once realtime delivers a message.
 */
export async function markCommunityChatRead(communityId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("mark_community_chat_read", { p_community_id: communityId });
}

export type PollOptionResult = {
  option_id: string;
  label: string;
  position: number;
  votes: number;
  voted_by_me: boolean;
};

/** Post a poll into a community chat room (UAT-005). 2–6 options. */
export async function createCommunityPoll(
  communityId: string,
  question: string,
  options: string[],
  anonymous = false
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const q = question.trim();
  const opts = options.map((o) => o.trim()).filter(Boolean);
  if (q.length < 1 || q.length > 300)
    return { ok: false, error: "Ask a question (1–300 characters)." };
  if (opts.length < 2 || opts.length > 6)
    return { ok: false, error: "A poll needs 2–6 options." };

  // Polls insert a chat message, so they share the chat room's send limit.
  // No send throttle on chat (see the note in (student)/chat/actions.ts): the
  // limiter fails closed, so any failure to consult it rejected an ordinary
  // message as "You're sending too fast". Membership is still enforced by RLS.

  const { error } = await supabase.rpc("create_community_poll", {
    p_community_id: communityId,
    p_question: q,
    p_options: opts,
    p_anonymous: anonymous,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Cast (or move) the caller's vote. One ballot per member per poll. */
export async function voteCommunityPoll(
  pollId: string,
  optionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("vote_community_poll", {
    p_poll_id: pollId,
    p_option_id: optionId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Tallies for a set of polls. Individual ballots are unreadable to other members
 * by RLS; this view aggregates them under definer rights and reports only the
 * caller's own choice.
 */
export async function fetchPollResults(
  pollIds: string[]
): Promise<Record<string, PollOptionResult[]>> {
  if (pollIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("community_poll_results")
    .select("poll_id, option_id, label, position, votes, voted_by_me")
    .in("poll_id", pollIds)
    .order("position", { ascending: true });

  const byPoll: Record<string, PollOptionResult[]> = {};
  for (const row of data ?? []) {
    const list = byPoll[row.poll_id as string] ?? [];
    list.push({
      option_id: row.option_id as string,
      label: row.label as string,
      position: row.position as number,
      votes: Number(row.votes),
      voted_by_me: Boolean(row.voted_by_me),
    });
    byPoll[row.poll_id as string] = list;
  }
  return byPoll;
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
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("moderate_community_post", {
    p_post_id: postId,
    p_approve: approve,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/communities");
  return { ok: true };
}

/**
 * FOLLOW — spectate a community: read its broadcasts and get notified, with no
 * approval and no seat in the chat room. Mirrored by JOIN below, which is the
 * participation half of the split introduced in mig 0119.
 */
export async function followCommunity(communityId: string): Promise<void> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return;
  await supabase
    .from("community_followers")
    .insert({ community_id: communityId, user_id: uid });
  revalidateCommunity(communityId);
}

export async function unfollowCommunity(communityId: string): Promise<void> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return;
  await supabase
    .from("community_followers")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", uid);
  revalidateCommunity(communityId);
}

export type JoinState = "none" | "pending" | "rejected" | "joined";

/**
 * JOIN — ask to participate. The owner (or a moderator / society officer)
 * approves; until then the student is a follower who cannot send messages.
 * The RPC also follows on your behalf, since asking implies wanting the feed.
 */
export async function requestJoinCommunity(
  communityId: string
): Promise<{ ok: true; status: JoinState } | { ok: false; error: string }> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const allowed = await checkRateLimit("community_join_request", 20, 60 * 60);
  if (!allowed) return { ok: false, error: "Too many join requests for now." };

  const { data, error } = await supabase.rpc("request_community_join", {
    p_community: communityId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateCommunity(communityId);
  return { ok: true, status: (data as JoinState) ?? "pending" };
}

/** Withdraw a pending ask (RLS allows deleting only your own row). */
export async function cancelJoinRequest(communityId: string): Promise<void> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return;
  await supabase
    .from("community_join_requests")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", uid);
  revalidateCommunity(communityId);
}

/** Owner / moderator / society officer approves or rejects a pending ask. */
export async function decideJoinRequest(
  communityId: string,
  userId: string,
  approve: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("decide_community_join_request", {
    p_community: communityId,
    p_user: userId,
    p_approve: approve,
  });
  if (error) return { ok: false, error: error.message };
  revalidateCommunity(communityId);
  return { ok: true };
}

/** Remove someone's participation (they keep following). Managers only. */
export async function removeCommunityMember(
  communityId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("remove_community_member", {
    p_community: communityId,
    p_user: userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidateCommunity(communityId);
  return { ok: true };
}

/** Leave a community you joined — participation only; the follow survives. */
export async function leaveCommunity(communityId: string) {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return;
  await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", uid);
  revalidateCommunity(communityId);
}

/**
 * Membership drives the community profile (whose Chat tab appears/disappears
 * with it), the societies profile, the discovery list, and — for Discover team
 * rooms only — the standalone /chat/c/<id> screen.
 */
function revalidateCommunity(communityId: string) {
  revalidatePath(`/communities/${communityId}`);
  revalidatePath(`/societies/${communityId}`);
  revalidatePath("/communities");
  revalidatePath("/chat");
  revalidatePath(`/chat/c/${communityId}`);
}

/**
 * Delete a chat room — OWNER only, consistent with fix-031 (a moderator does
 * not get this). Everything hanging off the room already cascades from
 * `communities`: messages, reads, followers, members, join requests, polls,
 * posts and — since mig 0132 — the notifications pointing at it. Events and
 * Discover posts deliberately survive with a null reference. `delete_chat_room`
 * (mig 0135) re-checks ownership and refuses societies and Discover team rooms,
 * which have their own lifecycles.
 */
export async function deleteChatRoom(
  communityId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("delete_chat_room", {
    p_id: communityId,
  });
  if (error)
    return {
      ok: false,
      error: error.message.includes("not authorized")
        ? "Only the owner can delete this chat room."
        : error.message,
    };

  // Every member's inbox and the discovery list both drop it.
  revalidatePath("/communities");
  revalidatePath("/chat");
  revalidatePath(`/chat/c/${communityId}`);
  return { ok: true };
}

/** Report a community (target_type = 'community'), feeds /admin/reports?type=community. */
export async function reportCommunity(
  communityId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const allowed = await checkRateLimit(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Too many reports for now." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: userId,
    target_type: "community",
    target_id: communityId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
