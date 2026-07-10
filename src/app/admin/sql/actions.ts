"use server";

import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";

export type SqlResult =
  | { error: string }
  | { mode: "read"; rows: Record<string, unknown>[] }
  | { mode: "write"; affected: number };

/** Run one SQL statement via the gated admin_run_sql RPC (super_admin only). */
export async function runSql(query: string, confirm: boolean): Promise<SqlResult> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_run_sql", {
    p_query: query,
    p_confirm: confirm,
  });
  if (error) return { error: error.message };
  const res = data as { mode: "read"; rows: Record<string, unknown>[] } | { mode: "write"; affected: number };
  return res;
}
