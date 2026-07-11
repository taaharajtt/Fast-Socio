"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

/** Issue an escalating strike (warn → restrict → suspend). Admin-gated in SQL. */
export async function issueStrike(userId: string, reason: string): Promise<Result> {
  const r = reason.trim();
  if (r.length < 3) return { ok: false, error: "Give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_strike", {
    p_user: userId,
    p_reason: r,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

/** Toggle a silent shadow ban (excluded from feed + Discover). */
export async function setShadowBan(userId: string, on: boolean): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_shadow_ban", {
    p_user: userId,
    p_on: on,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

/** Approve or reject an appeal (approving lifts the matching restriction). */
export async function decideAppeal(
  appealId: string,
  approve: boolean
): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_appeal", {
    p_appeal: appealId,
    p_approve: approve,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/appeals");
  return { ok: true };
}
