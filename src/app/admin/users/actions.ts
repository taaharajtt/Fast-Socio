"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
