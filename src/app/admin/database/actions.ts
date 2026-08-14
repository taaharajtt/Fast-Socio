"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";

type Result = { error: string } | { ok: true; row?: unknown };

/**
 * These three actions are the generic table editor at /admin/database. They
 * deliberately call the `admin_browser_*` RPCs rather than the unrestricted
 * `admin_*` ones the dedicated admin actions use.
 *
 * The wrappers (migration 0149) refuse to touch the audit/session tables and
 * refuse to write the privileged profiles columns — admin_role, is_banned,
 * verified, aura_score and friends — because each of those already has a
 * purpose-built audited action that captures a reason and fires the right side
 * effects. Without the wrapper the generic editor is a second, weaker path to
 * exactly the columns the 2026-07-15 privilege-escalation incident abused,
 * since the underlying RPCs are SECURITY DEFINER and so run past RLS, past the
 * profiles column GRANTs (migration 0084) and past protect_profile_columns()
 * (migration 0080).
 *
 * If a refusal shows up here as an error string, that is the guard working.
 * Do not "fix" it by pointing these back at the unwrapped RPCs.
 */

/** Update one row (single-column PK) via the guarded, audited SECURITY DEFINER RPC. */
export async function updateRow(
  table: string,
  pkCol: string,
  pkVal: string,
  patch: Record<string, unknown>,
): Promise<Result> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_browser_update_row", {
    p_table: table,
    p_pk_col: pkCol,
    p_pk_val: pkVal,
    p_row: patch,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/database/${table}`);
  return { ok: true, row: data };
}

export async function insertRow(
  table: string,
  values: Record<string, unknown>,
): Promise<Result> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_browser_insert_row", {
    p_table: table,
    p_row: values,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/database/${table}`);
  return { ok: true, row: data };
}

export async function deleteRow(
  table: string,
  pkCol: string,
  pkVal: string,
): Promise<Result> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_browser_delete_row", {
    p_table: table,
    p_pk_col: pkCol,
    p_pk_val: pkVal,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/database/${table}`);
  return { ok: true };
}
