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
