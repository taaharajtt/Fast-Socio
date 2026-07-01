import Link from "next/link";
import { notFound } from "next/navigation";
import { GlassCard, GlassChip } from "@/components/ui";
import { AuraAdjustForm } from "@/components/admin/aura-adjust-form";
import { createClient } from "@/lib/supabase/server";
import { auraReasonLabel } from "@/lib/aura/labels";

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, department, semester, aura_score, is_banned")
    .eq("id", id)
    .single();
  if (!profile) notFound();

  // Admin can read any user's ledger (RLS: own or admin).
  const { data: txns } = await supabase
    .from("aura_transactions")
    .select("id, delta, reason, created_at")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main>
      <Link href="/admin/users" className="text-sm text-fg-muted hover:text-fg">
        ← Users
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">
        {profile.full_name ?? "Unnamed"}
      </h1>
      <p className="mt-1 text-sm text-fg-muted">
        {profile.department ?? "—"}
        {profile.semester ? ` · Semester ${profile.semester}` : ""}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <GlassCard className="p-4">
          <p className="text-2xl font-bold text-aura">{profile.aura_score}</p>
          <p className="text-xs text-fg-muted">Aura score</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-2xl font-bold">
            {profile.is_banned ? "Banned" : "Active"}
          </p>
          <p className="text-xs text-fg-muted">Status</p>
        </GlassCard>
      </div>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-medium text-fg-muted">
          Adjust Aura (audited)
        </h2>
        <GlassCard className="p-4">
          <AuraAdjustForm userId={profile.id} />
        </GlassCard>
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-medium text-fg-muted">
          Recent transactions
        </h2>
        <div className="space-y-2">
          {(txns ?? []).map((t) => (
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
          {(txns ?? []).length === 0 && (
            <p className="text-sm text-fg-muted">No transactions.</p>
          )}
        </div>
      </section>
    </main>
  );
}
