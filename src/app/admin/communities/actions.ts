"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Approve or reject a pending community via the audited SECURITY DEFINER fn. */
export async function moderateCommunity(
  communityId: string,
  approve: boolean
): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("moderate_community", {
    p_community_id: communityId,
    p_approve: approve,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/communities");
}
