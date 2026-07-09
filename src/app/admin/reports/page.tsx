import { ReportRow, type AdminReport } from "@/components/admin/report-row";
import { PageHeader } from "@/components/admin/kit";
import { createClient } from "@/lib/supabase/server";

const TYPES = ["profile", "post", "comment", "message", "community", "event"];

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type = "profile" } = await searchParams;
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("reports")
    .select("id, target_type, target_id, reason, details, status, created_at")
    .eq("target_type", type)
    .order("created_at", { ascending: false });

  const reports = rows ?? [];

  // Resolve names for profile-type targets so the queue is readable.
  const names = new Map<string, string>();
  if (type === "profile" && reports.length > 0) {
    const ids = [...new Set(reports.map((r) => r.target_id))];
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name ?? ""));
  }

  const items: AdminReport[] = reports.map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    targetName: names.get(r.target_id) ?? null,
    reason: r.reason,
    details: r.details,
    status: r.status,
    // Pre-format on the server (stable UTC) to avoid locale hydration mismatch.
    createdAt: `${r.created_at.slice(0, 16).replace("T", " ")} UTC`,
  }));

  return (
    <>
      <PageHeader title="Reports" count={items.length} sub="Moderation queue." />

      {/* Type filter — underline tabs (server-friendly links). */}
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-glass-border">
        {TYPES.map((t) => (
          <a
            key={t}
            href={`/admin/reports?type=${t}`}
            className={
              t === type
                ? "-mb-px border-b-2 border-fg px-3 py-1.5 text-xs font-medium text-fg"
                : "px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
            }
          >
            {t}
          </a>
        ))}
      </nav>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
            No {type} reports.
          </p>
        ) : (
          items.map((r) => <ReportRow key={r.id} report={r} />)
        )}
      </div>
    </>
  );
}
