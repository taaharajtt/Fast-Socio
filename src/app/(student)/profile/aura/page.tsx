import Link from "next/link";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { auraReasonLabel } from "@/lib/aura/labels";
import { levelProgress, levelTitle } from "@/lib/aura/levels";

type Txn = {
  id: string;
  delta: number;
  reason: string;
  created_at: string;
};

export default async function AuraPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const [{ data: profile }, { data: txnRows }, { count: earnedCount }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("aura_score, xp, level")
        .eq("id", me)
        .single(),
      supabase
        .from("aura_transactions")
        .select("id, delta, reason, created_at")
        .eq("user_id", me)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("user_achievements")
        .select("code", { count: "exact", head: true })
        .eq("user_id", me),
    ]);

  const txns = (txnRows as Txn[]) ?? [];
  // xp/level land with mig 0055; fall back gracefully until it's applied.
  const xp = (profile as { xp?: number } | null)?.xp ?? 0;
  const prog = levelProgress(xp);

  // Breakdown by reason.
  const byReason = new Map<string, number>();
  for (const t of txns) {
    byReason.set(t.reason, (byReason.get(t.reason) ?? 0) + t.delta);
  }
  const breakdown = [...byReason.entries()]
    .map(([reason, total]) => ({ reason, total }))
    .sort((a, b) => b.total - a.total);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/profile"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="text-lg font-bold">Aura</h1>
      </div>

      <GlassCard radius="card" className="p-6 text-center">
        <p className="text-sm text-fg-muted">Your Aura</p>
        <p className="gradient-brand-text text-5xl font-extrabold">
          {profile?.aura_score ?? 0}
        </p>
      </GlassCard>

      {/* Level + XP progress (Refactor Phase 5). XP is lifetime positive
          contribution, so the level only ever climbs. */}
      <GlassCard radius="card" className="mt-3 p-5">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="gradient-brand-text text-2xl font-extrabold">
              Lv {prog.level}
            </span>
            <span className="text-sm font-medium text-fg-muted">
              {levelTitle(prog.level)}
            </span>
          </div>
          <span className="text-xs text-fg-muted">
            {xp.toLocaleString()} XP
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-glass-border">
          <div
            className="h-full rounded-full gradient-brand"
            style={{ width: `${Math.round(prog.fraction * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-fg-muted">
          {prog.remaining > 0
            ? `${prog.remaining.toLocaleString()} XP to level ${prog.level + 1}`
            : "Max progress"}
        </p>
      </GlassCard>

      <Link href="/profile/badges" className="mt-3 block">
        <GlassCard
          radius="card"
          className="flex items-center gap-3 p-4 transition-transform active:scale-[0.99]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gradient-brand">
            <Trophy className="h-5 w-5 text-white" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">Badges</p>
            <p className="text-xs text-fg-muted">
              {(earnedCount ?? 0) > 0
                ? `${earnedCount} earned`
                : "None earned yet"}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
        </GlassCard>
      </Link>

      {breakdown.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-medium text-fg-muted">Breakdown</h2>
          <GlassCard className="divide-y divide-glass-border p-0">
            {breakdown.map((b) => (
              <div
                key={b.reason}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="text-sm">{auraReasonLabel(b.reason)}</span>
                <span
                  className={
                    b.total >= 0 ? "text-sm text-aura" : "text-sm text-error"
                  }
                >
                  {b.total >= 0 ? "+" : ""}
                  {b.total}
                </span>
              </div>
            ))}
          </GlassCard>
        </section>
      )}

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-medium text-fg-muted">
          Recent activity
        </h2>
        {txns.length === 0 ? (
          <GlassCard className="p-5">
            <p className="text-sm text-fg-muted">
              No Aura activity yet. Match, post, and attend events to earn Aura.
            </p>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {txns.slice(0, 30).map((t) => (
              <GlassCard
                key={t.id}
                className="flex items-center justify-between p-3"
              >
                <span className="text-sm">{auraReasonLabel(t.reason)}</span>
                <GlassChip tone={t.delta >= 0 ? "aura" : "error"}>
                  {t.delta >= 0 ? "+" : ""}
                  {t.delta}
                </GlassChip>
              </GlassCard>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
