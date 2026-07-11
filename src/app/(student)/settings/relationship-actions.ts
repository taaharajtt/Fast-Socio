"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Block a user: hard cut (hides both ways in Discover, blocks chat via existing
 * RLS/RPCs). Also drops any mute to avoid a redundant pair.
 */
export async function blockUser(targetId: string): Promise<Result> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (targetId === user.id) return { ok: false, error: "You can't block yourself." };

  const { error } = await supabase
    .from("blocked_users")
    .upsert(
      { blocker_id: user.id, blocked_id: targetId },
      { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }
    );
  if (error) return { ok: false, error: error.message };
  await supabase
    .from("muted_users")
    .delete()
    .eq("muter_id", user.id)
    .eq("muted_id", targetId);
  revalidatePath("/settings/blocked");
  revalidatePath(`/profile/${targetId}`);
  return { ok: true };
}

export async function unblockUser(targetId: string): Promise<Result> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("blocked_users")
    .delete()
    .eq("blocker_id", user.id)
    .eq("blocked_id", targetId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/blocked");
  return { ok: true };
}

/** Mute a user: soft, one-directional hide (they're unaware). */
export async function muteUser(targetId: string): Promise<Result> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (targetId === user.id) return { ok: false, error: "You can't mute yourself." };
  const { error } = await supabase
    .from("muted_users")
    .upsert(
      { muter_id: user.id, muted_id: targetId },
      { onConflict: "muter_id,muted_id", ignoreDuplicates: true }
    );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/blocked");
  revalidatePath(`/profile/${targetId}`);
  return { ok: true };
}

export async function unmuteUser(targetId: string): Promise<Result> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const { error } = await supabase
    .from("muted_users")
    .delete()
    .eq("muter_id", user.id)
    .eq("muted_id", targetId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/blocked");
  return { ok: true };
}
