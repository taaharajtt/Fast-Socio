import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { timed } from "@/lib/perf";
import { resolveAvatarUrl } from "@/lib/avatar";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  RanksTabs,
  type StudentRow,
  type DeptRow as UiDeptRow,
} from "@/components/leaderboard/ranks-tabs";

type RpcDeptRow = {
  department: string;
  member_count: number;
  total_aura: number;
  per_capita: number;
  rank: number;
};

// No `unstable_instant` export here — it only adds build-time validation, and
// that validation currently trips on @sentry/nextjs reading the `sentry-trace`
// header during every server render. See the note in next.config.ts; the static
// shell itself is unaffected (this route builds as Partial Prerender).

/**
 * Ranks. The heading is fixed copy, so it prerenders and the tab lands on
 * something immediately; the two ranking RPCs (weekly board + department
 * rivalry) stream into the panel below.
 */
export default function LeaderboardPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-[28px] font-bold tracking-tight">Leaderboard</h1>
      <p className="mb-5 mt-1 text-sm text-fg-muted">
        Who&rsquo;s running campus this week?
      </p>

      <Suspense fallback={<SkeletonRows count={6} />}>
        <Rankings />
      </Suspense>
    </main>
  );
}

async function Rankings() {
  const supabase = await createClient();
  // Verified locally from the JWT — no Auth API round trip (middleware already
  // gated this route; RLS scopes every query below).
  const me = (await getAuthUserId())!;

  const [{ data: deptData }, { data: boardData }] = await timed(
    "leaderboard:rpcs",
    () =>
      Promise.all([
        supabase.rpc("get_department_rivalry"),
        supabase.rpc("get_weekly_leaderboard", { p_limit: 50 }),
      ])
  );
  const rpcDepts = (deptData as RpcDeptRow[]) ?? [];
  const students = (boardData as StudentRow[]) ?? [];

  // Derive each department's Aura earned THIS WEEK (and up to 4 contributing
  // avatars) from the weekly student board — real data, no historical snapshot
  // needed. Departments are ranked by all-time total_aura per the V3 design.
  const weeklyByDept = new Map<string, number>();
  const avatarsByDept = new Map<string, string[]>();
  for (const s of students) {
    if (!s.department) continue;
    weeklyByDept.set(
      s.department,
      (weeklyByDept.get(s.department) ?? 0) + Number(s.weekly_aura)
    );
    const src = resolveAvatarUrl(s.avatar_url, s.gender);
    if (src) {
      const list = avatarsByDept.get(s.department) ?? [];
      if (list.length < 4) list.push(src);
      avatarsByDept.set(s.department, list);
    }
  }

  const depts: UiDeptRow[] = rpcDepts
    .map((d) => ({
      department: d.department,
      member_count: Number(d.member_count),
      total_aura: Number(d.total_aura),
      weekly_change: weeklyByDept.get(d.department) ?? 0,
      avatars: avatarsByDept.get(d.department) ?? [],
    }))
    .sort((a, b) => b.total_aura - a.total_aura);

  // Leaderboard shows every student whose (dense) rank is <= 10 — not the
  // first 10 physical rows, which could cut a tied group in half. The full
  // board (`students`, up to 50 rows) still feeds the department-rivalry aura
  // derivation above.
  return (
    <RanksTabs
      students={students.filter((s) => s.rank <= 10)}
      depts={depts}
      meId={me}
    />
  );
}
