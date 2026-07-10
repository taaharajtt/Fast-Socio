"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Mark every notification read (UISpec V3 Screen 4 "Mark all read"). Unlike the
 * old behaviour — which auto-marked on open and so never let an unread row show
 * — reads are now an explicit user action, preserving the unread purple-border
 * state until the user taps "Mark all read".
 */
export async function markAllActivityRead(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  await supabase.rpc("mark_notifications_read");
  revalidatePath("/activity");
  return { ok: true };
}

/**
 * Dismiss the broadcast announcements shown in the cold-open modal (UAT-012).
 * `read_at` doubles as "already shown", so a dismissed announcement never
 * resurfaces. RLS restricts the update to the caller's own rows; we scope by
 * user_id too so a stray id can't touch anyone else's notifications.
 */
export async function dismissAnnouncements(
  ids: string[]
): Promise<{ ok: boolean }> {
  if (ids.length === 0) return { ok: true };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .eq("user_id", user.id)
    .eq("type", "announcement");
  return { ok: !error };
}
