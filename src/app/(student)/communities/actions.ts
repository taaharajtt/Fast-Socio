"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

/** Submit a new community for admin approval (status starts pending). */
export async function createCommunity(input: {
  name: string;
  description: string;
}): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = input.name.trim();
  if (name.length < 2 || name.length > 60)
    return { error: "Name must be 2–60 characters." };

  // Cap submissions to curb spam even though approval is manual.
  const allowed = await checkRateLimit("create_community", 5, 24 * 60 * 60);
  if (!allowed) return { error: "You've submitted too many communities today." };

  const { data, error } = await supabase
    .from("communities")
    .insert({
      owner_id: user.id,
      name,
      description: input.description.trim() || null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  redirect(`/communities/${data.id}`);
}

export async function joinCommunity(communityId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("community_members")
    .insert({ community_id: communityId, user_id: user.id, role: "member" });
  revalidatePath(`/communities/${communityId}`);
}

export async function leaveCommunity(communityId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", user.id);
  revalidatePath(`/communities/${communityId}`);
}

/** Report a community (target_type = 'community'), feeds /admin/reports?type=community. */
export async function reportCommunity(
  communityId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: "community",
    target_id: communityId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
