import { PageHeader, SectionLabel, Table, Th, Td, rowClass } from "@/components/admin/kit";
import { BulkAuraForm } from "@/components/admin/bulk-aura-form";
import { requireSuperAdmin } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";
import { auraReasonLabel } from "@/lib/aura/labels";

export default async function AdminAuraPage() {
  await requireSuperAdmin();
  const supabase = await createClient();

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [{ data: deptRows }, { data: txns }] = await Promise.all([
    supabase.from("profiles").select("department").not("department", "is", null),
    supabase
      .from("aura_transactions")
      .select("id, user_id, delta, reason, created_at")
      .gte("created_at", dayAgo)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const departments = [...new Set((deptRows ?? []).map((r) => r.department as string))].sort();

  // Anomaly view: biggest absolute aura moves in the last 24h.
  const rows = (txns ?? []).slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 15);
  const names = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => r.user_id))];
  if (ids.length > 0) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name ?? ""));
  }

  return (
    <>
      <PageHeader title="Aura" sub="Bulk grants and anomaly monitoring. super_admin only." />

      <SectionLabel>Bulk grant · audited per user</SectionLabel>
      <div className="mt-2">
        <BulkAuraForm departments={departments} />
      </div>

      <section className="mt-8">
        <SectionLabel>Largest moves · 24h</SectionLabel>
        <div className="mt-2">
          <Table minWidth={420}>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Reason</Th>
                <Th>When</Th>
                <Th className="text-right">Δ</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <Td className="text-fg-muted">No aura activity in the last 24h.</Td>
                  <Td />
                  <Td />
                  <Td />
                </tr>
              ) : (
                rows.map((t) => (
                  <tr key={t.id} className={rowClass}>
                    <Td className="text-fg">{names.get(t.user_id) ?? t.user_id.slice(0, 8)}</Td>
                    <Td className="text-fg-muted">{auraReasonLabel(t.reason)}</Td>
                    <Td className="font-mono text-xs text-fg-muted">
                      {`${t.created_at.slice(0, 16).replace("T", " ")} UTC`}
                    </Td>
                    <Td className={`text-right font-mono tabular-nums ${t.delta >= 0 ? "text-success" : "text-error"}`}>
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
