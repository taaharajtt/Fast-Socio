import Link from "next/link";
import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

type DeptRow = {
  department: string;
  per_capita: number;
  rank: number;
};

/** Compact department-rivalry snippet for the Home feed (UI Spec §5.4). */
export async function DeptRivalryStrip() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_department_rivalry");
  const rows = ((data as DeptRow[]) ?? []).slice(0, 3);
  if (rows.length === 0) return null;

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-fg-muted">
          Department rivalry
        </h2>
        <Link href="/leaderboard?tab=departments" className="text-xs text-aura">
          See all
        </Link>
      </div>
      <GlassCard className="divide-y divide-glass-border p-0">
        {rows.map((d, i) => (
          <div
            key={d.department}
            className="flex items-center gap-3 px-4 py-3"
          >
            <span className="text-lg">{medals[i]}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {d.department}
            </span>
            <span className="text-sm font-semibold text-aura">
              {d.per_capita}
            </span>
          </div>
        ))}
      </GlassCard>
    </section>
  );
}
