"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";

/** Break a match (super_admin only; audited). */
export async function unmatch(id: string): Promise<{ error: string } | void> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_row", {
    p_table: "matches",
    p_pk_col: "id",
    p_pk_val: id,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/matching");
}

/**
 * Remove a message request (super_admin only; audited).
 *
 * Uses the narrow admin_delete_message_request RPC rather than the generic
 * admin_delete_row. The generic one captures `to_jsonb(row)` into
 * moderation_audit_log.before_data before deleting — so every deletion wrote a
 * permanent plaintext copy of the request's opening message, which is private
 * user text, into the audit trail. The narrow RPC deletes the same row and
 * audits routing metadata only: id, sender, recipient, status, timestamps.
 *
 * Migration 0163 also removed message_requests from the generic row RPCs
 * entirely, so the old call would now be refused rather than silently leaking.
 */
export async function deleteRequest(id: string): Promise<{ error: string } | void> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_message_request", {
    p_id: id,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/matching");
}
