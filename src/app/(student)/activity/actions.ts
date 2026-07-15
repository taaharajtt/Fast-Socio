"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Mark every notification read automatically when the panel is opened. Called
 * once from the client on mount (AutoMarkRead), fire-and-forget. It deliberately
 * does NOT revalidate: the just-rendered page keeps its unread highlights for
 * THIS visit so the user still sees what's new, while the DB is cleared so the
 * bell badge is gone on the next navigation and the rows read as seen next time.
 */
export async function markActivityRead(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  await supabase.rpc("mark_notifications_read");
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
