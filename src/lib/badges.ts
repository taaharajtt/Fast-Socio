import type { SupabaseClient } from "@supabase/supabase-js";

/** A catalog badge row (public.achievements, re-seeded as badges in mig 0073). */
export type Badge = {
  code: string;
  title: string;
  description: string;
  icon: string;
  image_url: string | null;
  category: string;
  aura_reward: number;
  sort_order: number;
};

/** An earned badge with its artwork, for profile strips. */
export type EarnedBadge = {
  code: string;
  title: string;
  image_url: string | null;
  earned_at: string;
};

/**
 * Earned badges for a user, in catalog order. Both tables are readable by any
 * authenticated user (badges show on public profiles).
 */
export async function getEarnedBadges(
  supabase: SupabaseClient,
  userId: string
): Promise<EarnedBadge[]> {
  const { data } = await supabase
    .from("user_achievements")
    .select("earned_at, badge:achievements(code, title, image_url, sort_order)")
    .eq("user_id", userId);

  return ((data ?? []) as unknown as {
    earned_at: string;
    badge: { code: string; title: string; image_url: string | null; sort_order: number } | null;
  }[])
    .filter((r) => r.badge !== null)
    .sort((a, b) => a.badge!.sort_order - b.badge!.sort_order)
    .map((r) => ({
      code: r.badge!.code,
      title: r.badge!.title,
      image_url: r.badge!.image_url,
      earned_at: r.earned_at,
    }));
}
