"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Status = "pending" | "reviewing" | "actioned" | "dismissed";

/**
 * Update a report's status. RLS restricts this to admins (the policy uses
 * is_admin(auth.uid())), so a non-admin call is rejected at the database.
 */
export async function updateReportStatus(
  reportId: string,
  status: Status
): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({ status })
    .eq("id", reportId);
  if (error) return { error: error.message };
  revalidatePath("/admin/reports");
}
