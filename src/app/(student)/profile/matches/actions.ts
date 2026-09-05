"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";

/**
 * End the caller's match with `otherId` (mig 0182).
 *
 * Everything that makes this safe is in the database: `unmatch_user` is a
 * SECURITY DEFINER RPC that takes the OTHER person only and derives the caller
 * from auth.uid(), so no shape of call from a client can unmatch two third
 * parties, and `matches` has no client DELETE policy for a forged request to
 * fall back on. This action is transport — it calls the RPC and revalidates
 * the surfaces whose counts and lists just changed.
 */
export async function unmatchUser(
  otherId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!otherId || otherId === userId)
    return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("unmatch_user", { p_other: otherId });
  if (error) return { ok: false, error: "Could not unmatch. Please try again." };

  // Match counts appear on both profiles, the list itself changed, and the
  // conversation just became read-only in the inbox.
  revalidatePath("/profile/matches");
  revalidatePath("/profile");
  revalidatePath(`/profile/${otherId}`);
  revalidatePath("/chat");
  return { ok: true };
}
