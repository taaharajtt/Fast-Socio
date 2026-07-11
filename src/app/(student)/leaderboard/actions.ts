"use server";

import { createClient } from "@/lib/supabase/server";
import type { StudentRow } from "@/components/leaderboard/ranks-tabs";

export type LeaderboardPeriod = "weekly" | "monthly" | "alltime";

/**
 * Fetch a scoped student leaderboard (Refactor Phase 5). Weekly/monthly windows
 * aggregate the Aura ledger; all-time uses the cached net score. Returns the top
 * 10, mirroring the SSR default in the page.
 */
export async function fetchLeaderboard(
  period: LeaderboardPeriod
): Promise<StudentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_scoped_leaderboard", {
    p_period: period,
    p_limit: 50,
  });
  return ((data as StudentRow[]) ?? []).slice(0, 10);
}
