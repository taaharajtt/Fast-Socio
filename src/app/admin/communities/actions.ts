"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";

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

/**
 * Mark a society as official/verified (or revoke). verify_society() is
 * SECURITY DEFINER and checks is_admin internally; it also stamps verified_at
 * and writes a moderation audit row.
 */
export async function verifySociety(
  societyId: string,
  official: boolean
): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_society", {
    p_society: societyId,
    p_official: official,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/communities");
}

/** Permanently delete a community (super_admin only; audited before-snapshot). */
export async function deleteCommunity(
  communityId: string
): Promise<{ error: string } | void> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_row", {
    p_table: "communities",
    p_pk_col: "id",
    p_pk_val: communityId,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/communities");
}
