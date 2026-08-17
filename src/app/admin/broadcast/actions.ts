"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/admin/access";
import { orIlike } from "@/lib/postgrest/search";

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

/** The audiences the targeted composer can address (fix-045). */
export type Audience =
  | "all"
  | "verified"
  | "user"
  | "semester"
  | "degree"
  | "school";

/**
 * Resolved recipient count for the composer's preview (fix-045).
 *
 * Deliberately the SAME resolver the send uses (`admin_audience_ids`), so the
 * number shown can never drift from the number actually addressed.
 */
export async function previewAudience(
  audience: Audience,
  value: string | null
): Promise<{ count: number } | { error: string }> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_broadcast_preview", {
    p_audience: audience,
    p_value: value || null,
  });
  if (error) return { error: error.message };
  return { count: (data as number) ?? 0 };
}

/**
 * Send to a targeted audience. The RPC re-checks super_admin AND re-resolves
 * the audience at send time, so a stale preview can never decide delivery.
 */
export async function sendTargetedBroadcast(input: {
  title: string;
  body: string;
  url?: string;
  audience: Audience;
  value?: string | null;
}): Promise<BroadcastResult> {
  await requireSuperAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_broadcast_targeted", {
    p_title: input.title,
    p_body: input.body,
    p_url: input.url || null,
    p_audience: input.audience,
    p_value: input.value || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/broadcast");
  return { ok: true, recipients: (data as number) ?? 0 };
}

/** Type-ahead for the single-user audience. */
export async function searchAudienceUsers(
  query: string
): Promise<{ id: string; full_name: string | null; username: string | null }[]> {
  await requireSuperAdmin();
  const search = orIlike(["full_name", "username"], query, { minLength: 2 });
  if (!search) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username")
    .or(search)
    .eq("onboarding_completed", true)
    .limit(10);
  return (data as { id: string; full_name: string | null; username: string | null }[]) ?? [];
}
