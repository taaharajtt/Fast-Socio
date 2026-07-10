"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";

/** Approve or reject a pending event via the audited SECURITY DEFINER fn. */
export async function moderateEvent(
  eventId: string,
  approve: boolean
): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("moderate_event", {
    p_event_id: eventId,
    p_approve: approve,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/events");
}

/** Permanently delete an event (super_admin only; audited before-snapshot). */
export async function deleteEvent(
  eventId: string
): Promise<{ error: string } | void> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_row", {
    p_table: "events",
    p_pk_col: "id",
    p_pk_val: eventId,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/events");
}
