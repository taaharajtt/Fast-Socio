"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

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
