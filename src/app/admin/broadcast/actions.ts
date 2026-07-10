"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";

export type BroadcastResult = { error: string } | { ok: true; recipients: number };

/**
 * Send an announcement to a user segment. Each recipient gets an in-app
 * notification (type='announcement') which also fires a push. super_admin only,
 * audited. Segment: 'all' | 'verified', optionally scoped to a department.
 */
export async function sendBroadcast(input: {
  title: string;
  body: string;
  url?: string;
  segment: "all" | "verified";
  department?: string;
}): Promise<BroadcastResult> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_broadcast", {
    p_title: input.title,
    p_body: input.body,
    p_url: input.url || null,
    p_segment: input.segment,
    p_department: input.department || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/broadcast");
  return { ok: true, recipients: (data as number) ?? 0 };
}
