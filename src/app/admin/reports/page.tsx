import { ReportRow, type AdminReport } from "@/components/admin/report-row";
import { PageHeader } from "@/components/admin/kit";
import { createClient } from "@/lib/supabase/server";

const TYPES = [
  "profile",
  "post",
  "comment",
  "message",
  "community",
  "event",
  "help_request",
  "help_response",
  "society",
  "society_announcement",
  "matching_request",
];

/** Relative age (server-rendered → static text, no hydration concern). */
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Deep-link to the reported target where a destination exists. */
function targetHref(type: string, id: string): string | null {
  switch (type) {
    case "profile":
      return `/admin/users/${id}`;
    case "post":
      return `/post/${id}`;
    case "community":
      return `/communities/${id}`;
    case "event":
      return `/events/${id}`;
    case "help_request":
      return `/help/${id}`;
    case "society":
      return `/societies/${id}`;
    default:
      // help_response / society_announcement have no standalone page; each is
      // reviewed via its parent request / society.
      return null;
  }
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type = "profile" } = await searchParams;
  const supabase = await createClient();

  const [{ data: rows }, { data: allOpen }] = await Promise.all([
    supabase
      .from("reports")
      .select("id, target_type, target_id, reason, details, status, created_at")
      .eq("target_type", type)
      .order("created_at", { ascending: false }),
    // Open (pending/reviewing) counts per type for the tab badges.
    supabase.from("reports").select("target_type, status").in("status", ["pending", "reviewing"]),
  ]);

  const reports = rows ?? [];
  const openByType = new Map<string, number>();
  (allOpen ?? []).forEach((r) =>
    openByType.set(r.target_type, (openByType.get(r.target_type) ?? 0) + 1),
  );

  // Resolve names for profile-type targets so the queue is readable.
  const names = new Map<string, string>();
  if (type === "profile" && reports.length > 0) {
    const ids = [...new Set(reports.map((r) => r.target_id))];
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name ?? ""));
  }

  const items: AdminReport[] = reports.map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    targetName: names.get(r.target_id) ?? null,
    targetHref: targetHref(r.target_type, r.target_id),
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: `${r.created_at.slice(0, 16).replace("T", " ")} UTC`,
    age: ago(r.created_at),
  }));

  const openHere = items.filter((i) => i.status === "pending" || i.status === "reviewing").length;

  return (
    <>
      <PageHeader title="Reports" count={items.length} sub={`Moderation queue · ${openHere} open here.`} />

      {/* Type filter — underline tabs with open-count badges. */}
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-glass-border">
        {TYPES.map((t) => {
          const open = openByType.get(t) ?? 0;
          return (
            <a
              key={t}
              href={`/admin/reports?type=${t}`}
              className={
                t === type
                  ? "-mb-px flex items-center gap-1.5 border-b-2 border-fg px-3 py-1.5 text-xs font-medium text-fg"
                  : "flex items-center gap-1.5 px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
              }
            >
              {t}
              {open > 0 && (
                <span className="rounded-full bg-warning/15 px-1.5 font-mono text-[10px] text-warning">
                  {open}
                </span>
              )}
            </a>
          );
        })}
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
