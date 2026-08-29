import Link from "next/link";
import { PageHeader, StatusDot, Tag } from "@/components/admin/kit";
import { getAdminContext } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";

/**
 * The DM report queue — the only route from the admin console to a private
 * message, and it opens only onto messages a participant chose to disclose.
 *
 * This list carries no message content at all, so viewing the queue is not an
 * evidence disclosure and is not audited as one. Opening a case is.
 */
const STATUSES = ["pending", "reviewing", "actioned", "dismissed"] as const;

type CaseRow = {
  id: string;
  category: string;
  status: (typeof STATUSES)[number];
  evidence_count: number;
  created_at: string;
  reporter_id: string;
  reporter_name: string;
  reported_user_id: string;
  reported_name: string;
  assigned_to: string | null;
  assigned_name: string | null;
};

const statusTone: Record<string, string> = {
  pending: "warning",
  reviewing: "info",
  actioned: "success",
  dismissed: "neutral",
};

export default async function DmReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await getAdminContext();
  const { status } = await searchParams;
  const active = STATUSES.find((s) => s === status) ?? null;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("admin_dm_report_list", {
    p_status: active,
    p_limit: 100,
    p_offset: 0,
  });

  const res = (data ?? { rows: [], total: 0 }) as {
    rows: CaseRow[];
    total: number;
  };

  return (
    <>
      <PageHeader
        title="DM reports"
        count={res.total}
        sub="Participant-selected evidence. Full conversations are not accessible."
      />

      <nav className="mb-4 flex flex-wrap gap-1 border-b border-glass-border">
        <Link
          href="/admin/dm-reports"
          className={
            active === null
              ? "-mb-px border-b-2 border-fg px-3 py-1.5 text-xs font-medium text-fg"
              : "px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
          }
        >
          all
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/dm-reports?status=${s}`}
            className={
              s === active
                ? "-mb-px border-b-2 border-fg px-3 py-1.5 text-xs font-medium text-fg"
                : "px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
            }
          >
            {s}
          </Link>
        ))}
      </nav>

      {error && (
        <p role="alert" className="mb-4 font-mono text-[11px] text-error">
          {error.message}
        </p>
      )}

      <div className="space-y-2">
        {res.rows.length === 0 ? (
          <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
            No DM reports.
          </p>
        ) : (
          res.rows.map((c) => (
            <Link
              key={c.id}
              href={`/admin/dm-reports/${c.id}`}
              className="flex items-start justify-between gap-3 rounded-[4px] border border-glass-border px-4 py-3 hover:bg-card/50"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                  {c.reported_name}
                  <Tag>{c.category}</Tag>
                </p>
                <p className="mt-1 font-mono text-[11px] text-fg-muted">
                  {c.evidence_count} message{c.evidence_count === 1 ? "" : "s"} ·
                  reported by {c.reporter_name} ·{" "}
                  {c.created_at.slice(0, 16).replace("T", " ")} UTC
                  {c.assigned_name ? ` · ${c.assigned_name}` : ""}
                </p>
              </div>
              <StatusDot tone={statusTone[c.status]} label={c.status} />
            </Link>
          ))
        )}
      </div>
    </>
  );
}
