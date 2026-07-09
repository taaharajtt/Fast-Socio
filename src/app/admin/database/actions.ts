"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";

type Result = { error: string } | { ok: true; row?: unknown };

/** Update one row (single-column PK) via the audited SECURITY DEFINER RPC. */
export async function updateRow(
  table: string,
  pkCol: string,
  pkVal: string,
  patch: Record<string, unknown>,
): Promise<Result> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_row", {
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
  const { data, error } = await supabase.rpc("admin_insert_row", {
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
  const { error } = await supabase.rpc("admin_delete_row", {
    p_table: table,
    p_pk_col: pkCol,
    p_pk_val: pkVal,
  });
  if (error) return { error: error.message };
  revalidatePath(`/admin/database/${table}`);
  return { ok: true };
}
