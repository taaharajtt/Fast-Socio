import { PageHeader } from "@/components/admin/kit";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 30;

/**
 * Cross-feature moderation audit-log viewer. Admins can SELECT
 * moderation_audit_log directly (RLS policy "admins read moderation audit
 * log"), so no new DB object is needed — we read the table and resolve actor
 * names with a second query keyed by the page's actor ids.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  const { action, page } = await searchParams;
  const pageNum = Math.max(0, Number.parseInt(page ?? "0", 10) || 0);
  const from = pageNum * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  // Distinct actions present, for the filter row.
  const { data: actionRows } = await supabase
    .from("moderation_audit_log")
    .select("action")
    .order("action");
  const actions = [...new Set((actionRows ?? []).map((r) => r.action))];

  let query = supabase
    .from("moderation_audit_log")
    .select("id, actor_id, action, target_type, target_id, reason, metadata, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (action) query = query.eq("action", action);

  const { data: rows, count } = await query;
  const entries = rows ?? [];

  // Resolve actor names in one round trip.
  const names = new Map<string, string>();
  const actorIds = [...new Set(entries.map((e) => e.actor_id).filter(Boolean))];
  if (actorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds as string[]);
    (profs ?? []).forEach((p) => names.set(p.id, p.full_name ?? ""));
  }

  const total = count ?? 0;
  const hasPrev = pageNum > 0;
  const hasNext = to + 1 < total;

  const link = (p: number) => {
    const sp = new URLSearchParams();
    if (action) sp.set("action", action);
    if (p > 0) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/audit${qs ? `?${qs}` : ""}`;
  };

  const tab = (label: string, href: string, active: boolean) => (
    <a
      href={href}
      className={
        active
          ? "-mb-px border-b-2 border-fg px-3 py-1.5 text-xs font-medium text-fg"
          : "px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
      }
    >
      {label}
    </a>
  );

  return (
    <>
      <PageHeader title="Audit log" count={total} sub="Immutable record of moderation actions." />

      {/* Action filter — underline tabs (server-friendly links). */}
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-glass-border">
        {tab("all", "/admin/audit", !action)}
        {actions.map((a) =>
          tab(a, `/admin/audit?action=${encodeURIComponent(a)}`, a === action),
        )}
      </nav>

      <div className="divide-y divide-glass-border overflow-hidden rounded-[4px] border border-glass-border">
        {entries.length === 0 ? (
          <p className="px-4 py-3 text-sm text-fg-muted">No audit entries.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-mono text-sm">
                  <span className="text-fg">{e.action}</span>
                  {e.target_type && (
                    <span className="text-fg-muted"> · {e.target_type}</span>
                  )}
                </p>
                <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                  {/* Stable UTC — avoids locale hydration mismatch. */}
                  {`${e.created_at.slice(0, 16).replace("T", " ")} UTC`}
                </span>
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                by {e.actor_id ? names.get(e.actor_id) || "Unknown" : "System"}
                {e.target_id && (
                  <span className="font-mono"> · target {e.target_id.slice(0, 8)}</span>
                )}
              </p>
              {e.reason && <p className="mt-1 text-sm text-fg">{e.reason}</p>}
              {e.metadata &&
                Object.keys(e.metadata as Record<string, unknown>).length > 0 && (
                  <pre className="mt-2 overflow-x-auto rounded-[3px] border border-glass-border bg-input p-2 text-[11px] text-fg-muted">
                    {JSON.stringify(e.metadata, null, 2)}
                  </pre>
                )}
            </div>
          ))
        )}
      </div>

      {(hasPrev || hasNext) && (
        <div className="mt-4 flex items-center justify-between">
          {hasPrev ? (
            <a href={link(pageNum - 1)} className="text-xs text-fg-muted hover:text-fg hover:underline">
              ← Newer
            </a>
          ) : (
            <span />
          )}
          <span className="font-mono text-[11px] text-fg-muted">page {pageNum + 1}</span>
          {hasNext ? (
            <a href={link(pageNum + 1)} className="text-xs text-fg-muted hover:text-fg hover:underline">
              Older →
            </a>
          ) : (
            <span />
          )}
        </div>
      )}
    </>
  );
}
