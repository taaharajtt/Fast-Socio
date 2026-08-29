"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin/access";

type Result = { error: string } | { ok: true };

/**
 * One-to-one DM messages are deliberately absent from this list.
 *
 * The content browser used to moderate them like any other object, which meant
 * any moderator could hide or hard-delete an arbitrary private message with no
 * report behind it — and the delete path snapshotted the row, body included,
 * into the audit log. Migration 0160 removed the `'message'` branch from both
 * RPCs below, so passing it now raises. A DM is acted on only from the case
 * that disclosed it: see `src/app/admin/dm-reports/actions.ts`.
 */
export type ContentType = "post" | "comment" | "community";

/** Soft-hide / unhide a post, comment, or community chat message (audited). */
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
