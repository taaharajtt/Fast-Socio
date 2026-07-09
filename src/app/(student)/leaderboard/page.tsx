import { createClient } from "@/lib/supabase/server";
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

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const [{ data: deptData }, { data: boardData }] = await Promise.all([
    supabase.rpc("get_department_rivalry"),
    supabase.rpc("get_weekly_leaderboard", { p_limit: 50 }),
  ]);
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
    if (s.avatar_url) {
      const list = avatarsByDept.get(s.department) ?? [];
      if (list.length < 4) list.push(s.avatar_url);
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

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-[28px] font-bold tracking-tight">Leaderboard</h1>
      <p className="mb-5 mt-1 text-sm text-fg-muted">
        Who&rsquo;s running campus this week?
      </p>

      <RanksTabs students={students} depts={depts} meId={me} />
    </main>
  );
}
