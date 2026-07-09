import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionLabel, Table, Th, Td, rowClass } from "@/components/admin/kit";
import { AuraAdjustForm } from "@/components/admin/aura-adjust-form";
import { BanUserButton } from "@/components/admin/ban-user-button";
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
  const rows = txns ?? [];

  return (
    <>
      <Link
        href="/admin/users"
        className="font-mono text-[11px] uppercase tracking-wide text-fg-muted hover:text-fg"
      >
        ← Users
      </Link>

      <header className="mb-5 mt-2 border-b border-glass-border pb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-fg">
            {profile.full_name ?? "Unnamed"}
          </h1>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                profile.is_banned ? "bg-error" : "bg-success"
              }`}
            />
            {profile.is_banned ? "banned" : "active"}
          </span>
        </div>
        <p className="mt-1 text-xs text-fg-muted">
          {profile.department ?? "—"}
          {profile.semester ? ` · Semester ${profile.semester}` : ""}
          <span className="ml-2 font-mono text-fg-disabled">{profile.id}</span>
        </p>
      </header>

      {/* Stats — hairline pair, no accent. */}
      <div className="overflow-hidden rounded-[4px] border border-glass-border">
        <div className="grid grid-cols-2 gap-px bg-glass-border">
          <div className="bg-bg px-3 py-3">
            <p className="font-mono text-lg font-semibold tabular-nums text-fg">
              {profile.aura_score}
            </p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
              Aura score
            </p>
          </div>
          <div className="bg-bg px-3 py-3">
            <p className="font-mono text-lg font-semibold text-fg">
              {profile.is_banned ? "Banned" : "Active"}
            </p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
              Status
            </p>
          </div>
        </div>
      </div>

      <section className="mt-6">
        <SectionLabel>Adjust aura · audited</SectionLabel>
        <div className="mt-2 rounded-[4px] border border-glass-border p-3">
          <AuraAdjustForm userId={profile.id} />
        </div>
      </section>

      <section className="mt-6">
        <SectionLabel>{profile.is_banned ? "Restore access" : "Ban user"} · audited</SectionLabel>
        <div className="mt-2 rounded-[4px] border border-glass-border p-3">
          <BanUserButton userId={profile.id} isBanned={profile.is_banned} />
        </div>
      </section>

      <section className="mt-6">
        <SectionLabel>Recent transactions</SectionLabel>
        <div className="mt-2">
          <Table minWidth={420}>
            <thead>
              <tr>
                <Th>Reason</Th>
                <Th>When</Th>
                <Th className="text-right">Δ</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <Td className="text-fg-muted">No transactions.</Td>
                  <Td />
                  <Td />
                </tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.id} className={rowClass}>
                    <Td className="text-fg">{auraReasonLabel(t.reason)}</Td>
                    <Td className="font-mono text-xs text-fg-muted">
                      {`${t.created_at.slice(0, 16).replace("T", " ")} UTC`}
                    </Td>
                    <Td
                      className={`text-right font-mono tabular-nums ${
                        t.delta >= 0 ? "text-success" : "text-error"
                      }`}
                    >
                      {t.delta >= 0 ? "+" : ""}
                      {t.delta}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </section>
    </>
  );
}
