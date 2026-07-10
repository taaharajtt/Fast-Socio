import { PageHeader, SectionLabel } from "@/components/admin/kit";
import { BroadcastComposer } from "@/components/admin/broadcast-composer";
import { requireSuperAdmin } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";

type AuditRow = {
  id: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export default async function BroadcastPage() {
  await requireSuperAdmin();
  const supabase = await createClient();

  const [{ data: deptRows }, { data: recent }] = await Promise.all([
    supabase.from("profiles").select("department").not("department", "is", null),
    supabase
      .from("moderation_audit_log")
      .select("id, reason, metadata, created_at")
      .eq("action", "broadcast")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const departments = [...new Set((deptRows ?? []).map((r) => r.department as string))].sort();
  const history = (recent ?? []) as AuditRow[];

  return (
    <>
      <PageHeader
        title="Broadcast"
        sub="Send an announcement (in-app notification + push) to a user segment. super_admin only."
      />

      <BroadcastComposer departments={departments} />

      <section className="mt-8">
        <SectionLabel>Recent broadcasts</SectionLabel>
        <div className="mt-2 space-y-2">
          {history.length === 0 ? (
            <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
              No announcements sent yet.
            </p>
          ) : (
            history.map((h) => {
              const recipients = (h.metadata?.recipients as number) ?? 0;
              const segment = (h.metadata?.segment as string) ?? "all";
              const dept = h.metadata?.department as string | null;
              return (
                <div key={h.id} className="rounded-[4px] border border-glass-border p-3">
                  <p className="text-sm font-medium text-fg">{h.reason ?? "—"}</p>
                  {typeof h.metadata?.body === "string" && (
                    <p className="mt-1 text-sm text-fg-muted">{h.metadata.body as string}</p>
                  )}
                  <p className="mt-1 font-mono text-[11px] text-fg-muted">
                    {recipients} recipient{recipients === 1 ? "" : "s"} · {dept ?? segment} ·{" "}
                    {`${h.created_at.slice(0, 16).replace("T", " ")} UTC`}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </section>
    </>
  );
}
