"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Sign out every OTHER device (Refactor Phase 8). Uses Supabase's
 * `signOut({ scope: 'others' })`, which genuinely revokes all refresh tokens
 * except this session's — then clears the corresponding device-registry rows so
 * the list reflects reality. (Per-single-session revoke isn't offered by the
 * Auth API for a non-admin caller, so we don't fake it.)
 */
export async function signOutOtherDevices(currentId: string | null): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error: signErr } = await supabase.auth.signOut({ scope: "others" });
  if (signErr) return { ok: false, error: signErr.message };

  let q = supabase
    .from("user_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("revoked_at", null);
  if (currentId) q = q.neq("id", currentId);
  await q;

  await supabase.rpc("log_security_event", { p_event: "sessions_revoked_all" });
  revalidatePath("/settings/devices");
  return { ok: true };
}
