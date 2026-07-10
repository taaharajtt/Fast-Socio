"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";

async function del(table: string, id: string): Promise<{ error: string } | void> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_row", {
    p_table: table,
    p_pk_col: "id",
    p_pk_val: id,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/matching");
}

/** Break a match (super_admin only; audited). */
export async function unmatch(id: string): Promise<{ error: string } | void> {
  return del("matches", id);
}

/** Remove a message request (super_admin only; audited). */
export async function deleteRequest(id: string): Promise<{ error: string } | void> {
  return del("message_requests", id);
}
