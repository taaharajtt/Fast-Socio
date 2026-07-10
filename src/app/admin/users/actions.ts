"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";

export type GrantableRole = "moderator" | "super_admin" | null;

/**
 * Grant / change / revoke a user's admin role (super_admin only). Routes through
 * the audited admin_update_row RPC; the profiles trigger keeps is_admin in sync.
 */
export async function setUserRole(
  userId: string,
  role: GrantableRole,
): Promise<{ error: string } | void> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_row", {
    p_table: "profiles",
    p_pk_col: "id",
    p_pk_val: userId,
    p_row: { admin_role: role },
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

/** Toggle a user's verified badge (super_admin only; audited). */
export async function setVerified(
  userId: string,
  verified: boolean,
): Promise<{ error: string } | void> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_row", {
    p_table: "profiles",
    p_pk_col: "id",
    p_pk_val: userId,
    p_row: { verified },
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/users/${userId}`);
}

/** Admin manual Aura adjustment (audited SECURITY DEFINER fn). Reason mandatory. */
export async function adjustAura(
  userId: string,
  delta: number,
  reason: string
): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_adjust_aura", {
    p_user_id: userId,
    p_delta: delta,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/users/${userId}`);
}

/** Ban or restore a user (audited). Banned users are blocked at the middleware. */
export async function setUserBan(
  userId: string,
  banned: boolean,
  reason: string
): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_ban", {
    p_user_id: userId,
    p_banned: banned,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}
