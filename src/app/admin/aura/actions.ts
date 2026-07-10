"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";

export type BulkAuraResult = { error: string } | { ok: true; count: number };

/** Grant/deduct aura across a segment via the audited admin_bulk_aura RPC. */
export async function bulkAura(input: {
  delta: number;
  reason: string;
  segment: "all" | "verified";
  department?: string;
}): Promise<BulkAuraResult> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_bulk_aura", {
    p_delta: input.delta,
    p_reason: input.reason,
    p_segment: input.segment,
    p_department: input.department || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/aura");
  return { ok: true, count: (data as number) ?? 0 };
}
