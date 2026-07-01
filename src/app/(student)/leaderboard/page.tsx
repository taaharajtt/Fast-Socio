import Link from "next/link";
import { ChevronLeft } from "lucide-react";
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

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const isDepts = tab === "departments";
  const supabase = await createClient();

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-1 flex items-center gap-3">
        <Link
          href="/profile"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
      </div>
      <p className="mb-4 ml-12 text-sm text-fg-muted">
        This week · resets Monday 00:00 PKT
      </p>

      {/* Tabs */}
      <div className="glass mb-5 flex gap-1 rounded-[var(--radius-pill)] p-1">
        <Link
          href="/leaderboard"
          className={`flex-1 rounded-[var(--radius-pill)] py-2 text-center text-sm font-medium ${!isDepts ? "bg-aura text-white" : "text-fg-muted"}`}
        >
          Students
        </Link>
        <Link
          href="/leaderboard?tab=departments"
          className={`flex-1 rounded-[var(--radius-pill)] py-2 text-center text-sm font-medium ${isDepts ? "bg-aura text-white" : "text-fg-muted"}`}
        >
          Departments
        </Link>
      </div>

      {isDepts ? (
        <DepartmentBoard supabase={supabase} />
      ) : (
        <StudentBoard supabase={supabase} />
      )}
    </main>
  );
}

async function StudentBoard({
  supabase,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data } = await supabase.rpc("get_weekly_leaderboard", { p_limit: 50 });
  const rows = (data as Row[]) ?? [];
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

async function DepartmentBoard({
  supabase,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data } = await supabase.rpc("get_department_rivalry");
  const rows = (data as DeptRow[]) ?? [];

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
      <p className="mb-1 text-xs text-fg-muted">
        Ranked by average Aura per member (per-capita).
      </p>
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
