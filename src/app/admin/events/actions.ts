"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
