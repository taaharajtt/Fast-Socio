"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isChatMediaPathFor, MESSAGE_PAGE_SIZE } from "@/lib/chat-media";
import { loadInbox, type InboxData } from "@/app/(student)/chat/inbox-data";

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
 * Catch-up read: every message in a conversation NEWER than `cursor`.
 *
 * `postgres_changes` has no replay, so anything published while the socket was
 * down — a backgrounded PWA, a tunnel, a WebSocket the network ate — is simply
 * gone, and nothing in the thread ever went looking for it. `fetchOlderMessages`
 * above only pages backwards, so there was no way to close a FORWARD gap short
 * of a full reload. Called on mount, on every (re)subscribe, on focus/visibility
 * resume, on `online`, and from the polling fallback.
 *
 * THE CURSOR IS A PAIR, NOT A TIMESTAMP. Asking for `created_at > since` drops
 * any row written in the same microsecond as the newest one already on screen —
 * two messages sent in the same instant, which is exactly what a burst looks
 * like. The cursor is `(created_at, id)` and the predicate is the lexicographic
 * "greater than" on that pair, which is a total order over the table's rows and
 * therefore cannot skip one.
 *
 * A null cursor means the caller has nothing server-backed on screen (an empty
 * conversation). That is NOT a reason to skip the read — it is the case where a
 * first incoming message is most likely to have been missed — so it falls back
 * to the latest page, the same read the page itself does.
 *
 * RLS scopes rows to conversation participants exactly as the initial page read
 * does, and `hidden` moderated messages stay excluded to match it.
 */
export async function fetchNewerMessages(
  conversationId: string,
  cursor: { createdAt: string; id: string } | null
) {
  const supabase = await createClient();
  // Bounded on purpose. A thread that missed more than this while away is
  // better served by the page's own read on the next navigation than by
  // streaming an unbounded backlog into client state.
  const limit = MESSAGE_PAGE_SIZE * 2;

  if (!cursor) {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data ?? []) as unknown[]).slice().reverse();
  }

  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("hidden", false)
    .or(
      `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`
    )
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  return (data ?? []) as unknown[];
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
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { error: "Not signed in." };

  const { error } = await supabase
    .from("message_requests")
    .update({ status })
    .eq("id", requestId)
    .eq("recipient_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/chat");
}

export async function acceptMessageRequest(id: string) {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { error: "Not signed in." };

  // Look up the sender before flipping status so we can open the conversation.
  const { data: req } = await supabase
    .from("message_requests")
    .select("sender_id")
    .eq("id", id)
    .eq("recipient_id", userId)
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
  attachment?: Attachment,
  /** The message this one replies to (mig 0167). A DB trigger rejects a target
   *  outside this conversation, so a bad id fails the insert rather than
   *  writing a cross-conversation reference. */
  replyToId?: string | null
): Promise<
  | { ok: true; message: { id: string; created_at: string } }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const text = body.trim();
  if (!attachment && (text.length < 1 || text.length > 4000))
    return { ok: false, error: "Message must be 1–4000 characters." };
  // attachment.url is a client-supplied chat-media PATH (P5-01). Only accept a
  // well-formed path inside THIS conversation, so a caller can't attach another
  // conversation's object.
  if (attachment && !isChatMediaPathFor(attachment.url, conversationId))
    return { ok: false, error: "Invalid attachment." };

  // NO RATE LIMIT ON SENDING. Removed deliberately (see the note on
  // `sharePostToFriend` below): the limiter this used to call FAILS CLOSED, so
  // any failure to consult it — a missing function on the database, a dropped
  // connection — rejected an ordinary message as "You're sending too fast",
  // which is what users were actually hitting. Chat sends are now unthrottled;
  // RLS still enforces membership and blocks on every insert.

  // `.select()` so the caller gets the row's real id and timestamp back. That
  // id is what reconciles the optimistic bubble: the thread used to pair a
  // pending bubble with its authoritative row by comparing BODY TEXT, which
  // mis-paired them whenever someone sent the same short message twice in a
  // row, leaving a duplicate on screen. Returning the id makes the match exact
  // and costs nothing — the row has already been written.
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: userId,
      body: text || null,
      attachment_url: attachment?.url ?? null,
      attachment_type: attachment?.type ?? null,
      // Only present when it is actually a reply. PostgREST rejects the whole
      // insert if a payload names a column the database does not have, so
      // sending `reply_to_id: null` unconditionally would break ordinary
      // messages on any database where mig 0167 has not been applied yet.
      ...(replyToId ? { reply_to_id: replyToId } : {}),
    })
    .select("id, created_at")
    .single();
  if (error || !data)
    return { ok: false, error: error?.message ?? "Could not send that message." };

  // NOTE ON CACHE INVALIDATION — there is deliberately no `revalidatePath("/chat")`
  // here, and that is a considered choice rather than an omission. It would
  // re-render a server tree on the hottest path in the app, to fix one list on
  // a route the sender is not even looking at. It is also unnecessary now: the
  // sender's own INSERT reaches <InboxRealtime/> in the student layout, which is
  // subscribed from every screen INCLUDING inside this thread, re-reads just the
  // inbox and publishes it to the shared store. That also fixes the RECIPIENT's
  // inbox, which no amount of cache invalidation on the sender's request could.
  return {
    ok: true,
    message: { id: data.id as string, created_at: data.created_at as string },
  };
}

/** The shape a quoted (replied-to) message is rendered from. */
export type ReplyPreview = {
  id: string;
  sender_id: string;
  body: string | null;
  attachment_type: "image" | "voice" | null;
  shared_post_id: string | null;
  deleted_at: string | null;
};

/**
 * Fetch the quoted rows for a set of `reply_to_id`s.
 *
 * A reply can point at a message OLDER than the loaded page (or one that
 * arrived by realtime while the target was never loaded), so the quote cannot
 * always be resolved from what is on screen. RLS scopes these rows to
 * conversation participants exactly like every other message read, and the
 * conversation filter keeps the read bounded to the thread being viewed.
 */
export async function fetchReplyPreviews(
  conversationId: string,
  ids: string[]
): Promise<ReplyPreview[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("id, sender_id, body, attachment_type, shared_post_id, deleted_at")
    .eq("conversation_id", conversationId)
    .in("id", ids.slice(0, 100));
  return (data ?? []) as ReplyPreview[];
}

export type MatchedFriend = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  gender: string | null;
};

/** List the current user's matched friends (for the share sheet, CR-010). */
export async function listMatchedFriends(): Promise<MatchedFriend[]> {
  const supabase = await createClient();
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return [];
  const me = userId;

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
    .select("id, full_name, avatar_url, gender")
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
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  // Shared the chat-send limit until it was removed — kept limit-free with it
  // so sharing cannot fail with a throttle message the app no longer applies.

  const { data: conversationId, error: convErr } = await supabase.rpc(
    "get_or_create_conversation",
    { other_id: friendId }
  );
  if (convErr || !conversationId)
    return { ok: false, error: convErr?.message ?? "Could not open chat." };

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: userId,
    // No paperclip: the preview card is the attachment, and prefixing it with
    // an attachment glyph just draws a second, redundant one (fix-008).
    body: "Shared a post",
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
  // Local JWT verification — no Auth API round trip on this hot path.
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  if (!payload.body && !payload.sharedPostId)
    return { ok: false, error: "Nothing to forward." };

  // Unthrottled with the rest of the chat send path (see `sendMessage`).

  const { data: conversationId, error: convErr } = await supabase.rpc(
    "get_or_create_conversation",
    { other_id: friendId }
  );
  if (convErr || !conversationId)
    return { ok: false, error: convErr?.message ?? "Could not open chat." };

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_id: userId,
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
  // Local JWT verification — no Auth API round trip on this hot path.
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

/**
 * Toggle a pin on a message (Refactor Phase 10). Backed by a SECURITY DEFINER
 * RPC that checks the caller is a participant of the conversation — messages
 * has no client UPDATE policy. Returns the new pinned state.
 */
export async function togglePinMessage(
  messageId: string
): Promise<{ ok: true; pinned: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("toggle_pin_message", {
    p_message_id: messageId,
  });
  if (error) return { ok: false, error: "Could not pin this message." };
  return { ok: true, pinned: Boolean(data) };
}

/**
 * Re-read the inbox for the caller. Used by the inbox list when realtime says a
 * message, conversation, request or room post changed.
 *
 * This exists so that "something changed" costs ONE targeted read instead of
 * `router.refresh()`, which re-rendered the entire server tree — student
 * layout, dock, announcements and page — to update a preview line. RLS scopes
 * the read to the caller exactly as the page render does.
 */
export async function refreshInbox(): Promise<InboxData> {
  return loadInbox();
}
