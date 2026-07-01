import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { auraReasonLabel } from "@/lib/aura/labels";

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

  const [{ data: profile }, { data: txnRows }] = await Promise.all([
    supabase.from("profiles").select("aura_score").eq("id", me).single(),
    supabase
      .from("aura_transactions")
      .select("id, delta, reason, created_at")
      .eq("user_id", me)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const txns = (txnRows as Txn[]) ?? [];

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
