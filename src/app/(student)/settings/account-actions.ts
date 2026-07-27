"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";

/**
 * Deactivate: hide the profile from Discover (enforced in the RPC, mig 0058) and
 * mark the account dormant while preserving all data. Reversible via reactivate.
 */
export async function deactivateAccount(): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { error: error.message };
  // Leave a security-timeline breadcrumb (best-effort).
  await supabase.rpc("log_security_event", { p_event: "account_deactivated" });
  revalidatePath("/settings/account");
}

/** Restore a deactivated account. */
export async function reactivateAccount(): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .update({ deactivated_at: null })
    .eq("id", userId);
  if (error) return { error: error.message };
  await supabase.rpc("log_security_event", { p_event: "account_reactivated" });
  revalidatePath("/settings/account");
}

// Usernames are permanently fixed to the campus roll number (email local-part),
// assigned by handle_new_user() at signup and immutable thereafter (mig 0094).
// There is no change-username path by design.
