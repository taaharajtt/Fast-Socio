"use server";

import { createClient } from "@/lib/supabase/server";
import type { StudentRow } from "@/components/leaderboard/ranks-tabs";

export type LeaderboardPeriod = "weekly" | "monthly" | "alltime";

/**
 * Fetch a scoped student leaderboard (Refactor Phase 5). Weekly/monthly windows
 * aggregate the Aura ledger; all-time uses the cached net score. Returns every
 * row whose (dense) rank is <= 10 — not the first 10 physical rows, which could
 * cut a tied group in half — mirroring the SSR default in the page. The RPC's
 * `rank` is dense: ties share a rank and the next rank is always +1 with no
 * gap, so this can return more than 10 rows whenever ties land at the boundary.
 */
export async function fetchLeaderboard(
  period: LeaderboardPeriod
): Promise<StudentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_scoped_leaderboard", {
    p_period: period,
    p_limit: 50,
  });
  return ((data as StudentRow[]) ?? []).filter((r) => r.rank <= 10);
}
