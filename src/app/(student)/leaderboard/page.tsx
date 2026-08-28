import { Suspense } from "react";
import { cacheLife } from "next/cache";
import { createAnonClient } from "@/lib/supabase/anon";
import { getAuthUserId } from "@/lib/auth/user";
import { timed } from "@/lib/perf";
import { resolveAvatarUrl } from "@/lib/avatar";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ScreenHeader } from "@/components/ui";
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
      <ScreenHeader
        title="Leaderboard"
        subtitle={<>Who&rsquo;s running campus this week?</>}
        className="mb-5"
      />

      <Suspense fallback={<SkeletonRows count={6} />}>
        <Rankings />
      </Suspense>
    </main>
  );
}

/**
 * The board itself is identical for every viewer, so it is cached once per
 * revalidation window instead of being recomputed per request. Both RPCs are
 * SECURITY DEFINER and executable by `anon`, so the anon client returns exactly
 * the same rows a signed-in student would get — nothing here is viewer-scoped.
 *
 * The viewer's own id is deliberately NOT read in this scope: cached scopes
 * cannot read cookies, and folding a per-user value in here would key the cache
 * per user and defeat the point. `Rankings` reads it outside and passes it down.
 */
async function getBoard() {
  "use cache";
  // Aura moves continuously but nobody needs a second-accurate ranking, and
  // this route was one of the heaviest prefetch targets in the access log.
  cacheLife("minutes");

  const supabase = createAnonClient();
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
  return { students: students.filter((s) => s.rank <= 10), depts };
}

async function Rankings() {
  // Verified locally from the JWT — no Auth API round trip (middleware already
  // gated this route). Read OUTSIDE `getBoard` so the board stays shareable.
  const me = (await getAuthUserId())!;
  const { students, depts } = await getBoard();

  return <RanksTabs students={students} depts={depts} meId={me} />;
}
