"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
  return setRequestStatus(id, "accepted");
}

export async function declineMessageRequest(id: string) {
  return setRequestStatus(id, "declined");
}
