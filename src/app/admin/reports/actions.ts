"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Status = "pending" | "reviewing" | "actioned" | "dismissed";

/**
 * Update a report's status via the moderate_report RPC (admin-gated in the DB).
 * Unlike a bare status update, this also hides the target content when the
 * report is 'actioned' (and restores it otherwise) — P3-03.
 */
export async function updateReportStatus(
  reportId: string,
  status: Status
): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("moderate_report", {
    p_report_id: reportId,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/reports");
}
