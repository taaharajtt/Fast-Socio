import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { LEADERBOARD_TITLES } from "@/lib/leaderboard/titles";

type Row = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  department: string | null;
  weekly_aura: number;
  rank: number;
};

type DeptRow = {
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
  const depts = (deptData as DeptRow[]) ?? [];
  const rows = (boardData as Row[]) ?? [];
  const myRow = rows.find((r) => r.user_id === me) ?? null;

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
      <p className="mb-5 text-sm text-fg-muted">
        This week · resets Monday 00:00 PKT
      </p>

      {/* CR-007: Department Rivalry at the TOP of the Leaderboard page. */}
      <section className="mb-7">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
          🏆 Department Rivalry
        </h2>
        <p className="mb-2 text-xs text-fg-muted">
          Ranked by average Aura per member (per-capita).
        </p>
        <DepartmentBoard rows={depts} />
      </section>

      <section className="mb-7">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          ⚡ Weekly Leaderboard
        </h2>
        <StudentBoard rows={rows} />
      </section>

      {/* Your rank */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
          📊 Your Rank
        </h2>
        <GlassCard strong className="flex items-center justify-between p-4">
          <span className="font-semibold">
            {myRow ? `#${myRow.rank} this week` : "Unranked this week"}
          </span>
          <span className="text-lg font-bold text-aura">
            {myRow?.weekly_aura ?? 0} Aura
          </span>
        </GlassCard>
      </section>
    </main>
  );
}

function StudentBoard({ rows }: { rows: Row[] }) {
  const top3 = rows.filter((r) => r.rank <= 3);
  const rest = rows.filter((r) => r.rank > 3);

  if (rows.length === 0) {
    return (
      <GlassCard className="p-6 text-center">
        <p className="text-sm text-fg-muted">
          No Aura earned yet this week. Match, post, and attend events to climb.
        </p>
      </GlassCard>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {top3.map((r) => {
          const t = LEADERBOARD_TITLES[r.rank];
          return (
            <GlassCard
              key={r.user_id}
              strong
              className="flex items-center gap-4 p-4"
              style={{
                borderColor: t ? `${t.tint}66` : undefined,
                boxShadow: t ? `0 6px 28px ${t.tint}22` : undefined,
              }}
            >
              <span className="text-2xl">{t?.emoji}</span>
              <div
                className="glass h-14 w-14 shrink-0 overflow-hidden rounded-full"
                style={{ boxShadow: t ? `0 0 0 2px ${t.tint}88` : undefined }}
              >
                {r.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.avatar_url}
                    alt={r.full_name ?? ""}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{r.full_name ?? "Student"}</p>
                <p className="text-xs font-medium" style={{ color: t?.tint }}>
                  {t?.title}
                </p>
                {r.department && (
                  <p className="truncate text-xs text-fg-muted">
                    {r.department}
                  </p>
                )}
              </div>
              <span className="text-lg font-bold text-aura">
                {r.weekly_aura}
              </span>
            </GlassCard>
          );
        })}
      </div>
      {rest.length > 0 && (
        <div className="mt-4 space-y-2">
          {rest.map((r) => (
            <GlassCard key={r.user_id} className="flex items-center gap-3 p-3">
              <span className="w-6 text-center text-sm font-semibold text-fg-muted">
                {r.rank}
              </span>
              <div className="glass h-10 w-10 shrink-0 overflow-hidden rounded-full">
                {r.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.avatar_url}
                    alt={r.full_name ?? ""}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {r.full_name ?? "Student"}
                </p>
                {r.department && (
                  <p className="truncate text-xs text-fg-muted">
                    {r.department}
                  </p>
                )}
              </div>
              <span className="text-sm font-semibold text-aura">
                {r.weekly_aura}
              </span>
            </GlassCard>
          ))}
        </div>
      )}
    </>
  );
}

function DepartmentBoard({ rows }: { rows: DeptRow[] }) {
  if (rows.length === 0) {
    return (
      <GlassCard className="p-6 text-center">
        <p className="text-sm text-fg-muted">
          No department activity yet this week.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((d) => {
        const t = LEADERBOARD_TITLES[d.rank];
        return (
          <GlassCard
            key={d.department}
            strong={d.rank <= 3}
            className="flex items-center gap-3 p-4"
            style={{
              borderColor: t ? `${t.tint}66` : undefined,
            }}
          >
            <span className="w-7 text-center text-lg font-bold">
              {t?.emoji ?? d.rank}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{d.department}</p>
              <p className="text-xs text-fg-muted">
                {d.member_count} member{d.member_count === 1 ? "" : "s"} ·{" "}
                {d.total_aura} total
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-aura">{d.per_capita}</p>
              <p className="text-[10px] text-fg-muted">per member</p>
            </div>
          </GlassCard>
        );
      })}
    </div>
  );
}
