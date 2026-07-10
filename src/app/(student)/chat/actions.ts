"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isChatMediaPathFor, MESSAGE_PAGE_SIZE } from "@/lib/chat-media";

/**
 * Fetch a page of messages older than `cursor` in a conversation (P4-01). RLS
 * scopes rows to conversation participants; returned oldest-first for prepending
 * above the current thread. Hidden (moderated) messages are excluded.
 */
export async function fetchOlderMessages(
  conversationId: string,
  cursor: string
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("hidden", false)
    .lt("created_at", cursor)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  return ((data ?? []) as unknown[]).slice().reverse();
}

/**
 * Accept or decline an incoming message request. RLS restricts updates to the
 * recipient, so we additionally scope by recipient_id = auth.uid(). An accepted
 * request becomes a conversation in Phase 3 (Chat).
 */
async function setRequestStatus(
  requestId: string,
  status: "accepted" | "declined"
): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("message_requests")
    .update({ status })
    .eq("id", requestId)
    .eq("recipient_id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/chat");
}

export async function acceptMessageRequest(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Look up the sender before flipping status so we can open the conversation.
  const { data: req } = await supabase
    .from("message_requests")
    .select("sender_id")
    .eq("id", id)
    .eq("recipient_id", user.id)
    .single();

  const result = await setRequestStatus(id, "accepted");
  if (result?.error) return result;

  // Now that the request is accepted, a conversation is eligible — create it.
  if (req?.sender_id) {
    await supabase.rpc("get_or_create_conversation", {
      other_id: req.sender_id,
    });
  }
  revalidatePath("/chat");
}

export async function declineMessageRequest(id: string) {
  return setRequestStatus(id, "declined");
}

/**
 * Open (or create) the conversation with another user and navigate to it. The
 * DB function enforces eligibility (match or accepted request) + no active block.
 */
export async function openConversation(otherId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_conversation", {
    other_id: otherId,
  });
  if (error || !data) {
    return { error: error?.message ?? "Could not open conversation." };
  }
  redirect(`/chat/${data}`);
}

type Attachment = { url: string; type: "image" | "voice" };

/** Send a message in a conversation. Rate-limited; RLS enforces membership + blocks. */
export async function sendMessage(
  conversationId: string,
  body: string,
  attachment?: Attachment
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const text = body.trim();
  if (!attachment && (text.length < 1 || text.length > 4000))
    return { ok: false, error: "Message must be 1–4000 characters." };
  // attachment.url is a client-supplied chat-media PATH (P5-01). Only accept a
  // well-formed path inside THIS conversation, so a caller can't attach another
  // conversation's object.
  if (attachment && !isChatMediaPathFor(attachment.url, conversationId))
    return { ok: false, error: "Invalid attachment." };

  const allowed = await checkRateLimit(
    "chatSend",
    RATE_LIMITS.chatSend.max,
    RATE_LIMITS.chatSend.windowSeconds
  );
  if (!allowed) return { ok: false, error: "You're sending too fast." };

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: text || null,
    attachment_url: attachment?.url ?? null,
    attachment_type: attachment?.type ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type MatchedFriend = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

/** List the current user's matched friends (for the share sheet, CR-010). */
export async function listMatchedFriends(): Promise<MatchedFriend[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const me = user.id;

  const { data: matchRows } = await supabase
    .from("matches")
    .select("user_low, user_high")
    .or(`user_low.eq.${me},user_high.eq.${me}`);

  const otherIds = (matchRows ?? []).map((m) =>
    m.user_low === me ? m.user_high : m.user_low
  );
  if (otherIds.length === 0) return [];

  const { data: profs } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url")
    .in("id", otherIds);
  return (profs as MatchedFriend[]) ?? [];
}

/**
 * Share a post to a matched friend via direct message (CR-010). Opens/creates
 * the conversation (eligibility enforced by get_or_create_conversation) and
 * inserts a message carrying shared_post_id.
 */
export async function sharePostToFriend(
  friendId: string,
  postId: string
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Share-to-DM inserts a chat message, so it must share the chat send limit
  // (P5-05) — otherwise it's an unthrottled message-spam path.
  const allowed = await checkRateLimit(
    "chatSend",
    RATE_LIMITS.chatSend.max,
    RATE_LIMITS.chatSend.windowSeconds
  );
  if (!allowed) return { ok: false, error: "You're sharing too fast." };

  const { data: conversationId, error: convErr } = await supabase.rpc(
    "get_or_create_conversation",
    { other_id: friendId }
  );
  if (convErr || !conversationId)
    return { ok: false, error: convErr?.message ?? "Could not open chat." };

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: "📎 Shared a post",
    shared_post_id: postId,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, conversationId: conversationId as string };
}

/**
 * Edit one of the caller's own text messages (UAT-009). Backed by a SECURITY
 * DEFINER RPC rather than an UPDATE policy: `messages` has no client UPDATE
 * policy at all, so there is no path by which a sender could rewrite read_at,
 * un-hide a moderated message, or touch a row they don't own.
 */
export async function editMessage(
  messageId: string,
  body: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const text = body.trim();
  if (text.length < 1 || text.length > 4000)
    return { ok: false, error: "Message must be 1–4000 characters." };

  const { error } = await supabase.rpc("edit_message", {
    p_message_id: messageId,
    p_body: text,
  });
  if (error) return { ok: false, error: "Only your own text messages can be edited." };
  return { ok: true };
}

/**
 * Soft-delete one of the caller's own messages. The row survives (read receipts
 * and moderation records point at it) but its body and attachment are cleared.
 */
export async function deleteMessage(
  messageId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_message", {
    p_message_id: messageId,
  });
  if (error) return { ok: false, error: "Only your own messages can be deleted." };
  return { ok: true };
}

/** Toggle the caller's emoji reaction on a message (UAT-005). One per user. */
export async function toggleMessageReaction(
  messageId: string,
  emoji: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("toggle_message_reaction", {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Forward a message's content to a matched friend (UAT-005). Text and shared
 * posts are forwarded verbatim; the caller only ever forwards what they can
 * already read. Reuses the chat send-rate limit since it inserts a message.
 */
export async function forwardMessage(
  friendId: string,
  payload: { body?: string | null; sharedPostId?: string | null }
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  if (!payload.body && !payload.sharedPostId)
    return { ok: false, error: "Nothing to forward." };

  const allowed = await checkRateLimit(
    "chatSend",
    RATE_LIMITS.chatSend.max,
    RATE_LIMITS.chatSend.windowSeconds
  );
  if (!allowed) return { ok: false, error: "You're forwarding too fast." };

  const { data: conversationId, error: convErr } = await supabase.rpc(
    "get_or_create_conversation",
    { other_id: friendId }
  );
  if (convErr || !conversationId)
    return { ok: false, error: convErr?.message ?? "Could not open chat." };

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: payload.sharedPostId ? (payload.body ?? "Forwarded a post") : payload.body,
    shared_post_id: payload.sharedPostId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, conversationId: conversationId as string };
}

/** Report a specific message for moderator review (target_type = 'message'). */
export async function reportMessage(
  messageId: string,
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
    target_type: "message",
    target_id: messageId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Mark the other party's messages in a conversation as read. */
export async function markConversationRead(conversationId: string) {
  const supabase = await createClient();
  await supabase.rpc("mark_conversation_read", { conv_id: conversationId });
}
