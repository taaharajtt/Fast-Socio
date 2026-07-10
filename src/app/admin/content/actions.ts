"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin/access";

type Result = { error: string } | { ok: true };

export type ContentType = "post" | "comment" | "message" | "community";

/** Soft-hide / unhide a post, comment, or message (audited). */
export async function setHidden(
  type: ContentType,
  id: string,
  hidden: boolean,
): Promise<Result> {
  await getAdminContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_content_hidden", {
    p_type: type,
    p_id: id,
    p_hidden: hidden,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/content");
  return { ok: true };
}

/** Hard-delete any content item (audited, before-snapshot captured). */
export async function deleteContent(type: ContentType, id: string): Promise<Result> {
  await getAdminContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_content", {
    p_type: type,
    p_id: id,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/content");
  return { ok: true };
}

/** Delete a single DM message from a conversation transcript (audited). */
export async function deleteMessage(id: string, conversationId: string): Promise<Result> {
  await getAdminContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_content", {
    p_type: "message",
    p_id: id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/content/dm/${conversationId}`);
  return { ok: true };
}
