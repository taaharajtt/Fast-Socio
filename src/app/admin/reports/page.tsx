import { ReportRow, type AdminReport } from "@/components/admin/report-row";
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
    <main>
      <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Moderation queue · {items.length} {type} report
        {items.length === 1 ? "" : "s"}
      </p>

      {/* Type filter — a server-friendly link row (admin is utilitarian). */}
      <nav className="mt-4 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <a
            key={t}
            href={`/admin/reports?type=${t}`}
            className={
              t === type
                ? "rounded-full bg-aura px-3 py-1 text-sm text-white"
                : "glass rounded-full px-3 py-1 text-sm text-fg-muted"
            }
          >
            {t}
          </a>
        ))}
      </nav>

      <div className="mt-5 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-fg-muted">No {type} reports.</p>
        ) : (
          items.map((r) => <ReportRow key={r.id} report={r} />)
        )}
      </div>
    </main>
  );
}
