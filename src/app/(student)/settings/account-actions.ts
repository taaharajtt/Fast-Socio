"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Deactivate: hide the profile from Discover (enforced in the RPC, mig 0058) and
 * mark the account dormant while preserving all data. Reversible via reactivate.
 */
export async function deactivateAccount(): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { error: error.message };
  // Leave a security-timeline breadcrumb (best-effort).
  await supabase.rpc("log_security_event", { p_event: "account_deactivated" });
  revalidatePath("/settings/account");
}

/** Restore a deactivated account. */
export async function reactivateAccount(): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .update({ deactivated_at: null })
    .eq("id", user.id);
  if (error) return { error: error.message };
  await supabase.rpc("log_security_event", { p_event: "account_reactivated" });
  revalidatePath("/settings/account");
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/**
 * Change username with a live-checked format + uniqueness. The 30-day cooldown
 * is enforced authoritatively by a DB trigger (mig 0058); we surface its error.
 */
export async function changeUsername(
  raw: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const username = raw.trim().toLowerCase();
  if (!USERNAME_RE.test(username))
    return {
      ok: false,
      error: "3–20 chars, lowercase letters, numbers or underscore.",
    };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Friendly pre-check (the unique index is the real guard).
  const { data: taken } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .neq("id", user.id)
    .maybeSingle();
  if (taken) return { ok: false, error: "That username is taken." };

  const { error } = await supabase
    .from("profiles")
    .update({ username })
    .eq("id", user.id);
  if (error) {
    if (error.message.includes("once every 30 days"))
      return { ok: false, error: "You can only change your username once every 30 days." };
    if (error.code === "23505") return { ok: false, error: "That username is taken." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/settings/account");
  return { ok: true };
}
