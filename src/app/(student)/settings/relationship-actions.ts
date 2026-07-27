"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";

type Result = { ok: true } | { ok: false; error: string };

async function currentUser() {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  return { supabase, userId };
}

/**
 * Block a user: hard cut (hides both ways in Discover, blocks chat via existing
 * RLS/RPCs). Also drops any mute to avoid a redundant pair.
 */
export async function blockUser(targetId: string): Promise<Result> {
  const { supabase, userId } = await currentUser();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (targetId === userId) return { ok: false, error: "You can't block yourself." };

  const { error } = await supabase
    .from("blocked_users")
    .upsert(
      { blocker_id: userId, blocked_id: targetId },
      { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }
    );
  if (error) return { ok: false, error: error.message };
  await supabase
    .from("muted_users")
    .delete()
    .eq("muter_id", userId)
    .eq("muted_id", targetId);
  revalidatePath("/settings/blocked");
  revalidatePath(`/profile/${targetId}`);
  return { ok: true };
}

export async function unblockUser(targetId: string): Promise<Result> {
  const { supabase, userId } = await currentUser();
  if (!userId) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", targetId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/blocked");
  return { ok: true };
}

/** Mute a user: soft, one-directional hide (they're unaware). */
export async function muteUser(targetId: string): Promise<Result> {
  const { supabase, userId } = await currentUser();
  if (!userId) return { ok: false, error: "Not signed in." };
  if (targetId === userId) return { ok: false, error: "You can't mute yourself." };
  const { error } = await supabase
    .from("muted_users")
    .upsert(
      { muter_id: userId, muted_id: targetId },
      { onConflict: "muter_id,muted_id", ignoreDuplicates: true }
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/blocked");
  revalidatePath(`/profile/${targetId}`);
  return { ok: true };
}

export async function unmuteUser(targetId: string): Promise<Result> {
  const { supabase, userId } = await currentUser();
  if (!userId) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("muted_users")
    .delete()
    .eq("muter_id", userId)
    .eq("muted_id", targetId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/blocked");
  return { ok: true };
}
