import Link from "next/link";
import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export default async function AdminHome() {
  const supabase = await createClient();

  // Lightweight KPIs for the landing dashboard (expanded in Phase 11).
  const [{ count: pendingReports }, { count: matches }, { count: users }] =
    await Promise.all([
      supabase
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase.from("matches").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
    ]);

  const kpis = [
    { label: "Students", value: users ?? 0 },
    { label: "Matches", value: matches ?? 0 },
    { label: "Pending reports", value: pendingReports ?? 0 },
  ];

  return (
    <main>
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Full analytics land in Phase 11. Feature moderation slices ship with
        their phases.
      </p>

      <div className="mt-5 grid grid-cols-3 gap-3">
        {kpis.map((k) => (
          <GlassCard key={k.label} className="p-4">
            <p className="text-2xl font-bold">{k.value}</p>
            <p className="text-xs text-fg-muted">{k.label}</p>
          </GlassCard>
        ))}
      </div>

      <div className="mt-5">
        <Link
          href="/admin/reports?type=profile"
          className="text-sm text-aura hover:underline"
        >
          Review profile reports →
        </Link>
      </div>
    </main>
  );
}
