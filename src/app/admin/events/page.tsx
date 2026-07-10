import { EventAdminRow, type AdminEvent } from "@/components/admin/event-admin-row";
import { PageHeader } from "@/components/admin/kit";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin/access";
import { formatEventDate } from "@/lib/events/format";

const FILTERS = ["pending", "approved", "rejected", "all"];

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { isSuper } = await getAdminContext();
  const { status = "pending" } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("events")
    .select("id, title, category, location, starts_at, host_id, attendee_count, status")
    .order("starts_at", { ascending: true });
  if (status !== "all") query = query.eq("status", status);

  const { data: rows } = await query;
  const events = rows ?? [];

  const hostIds = [...new Set(events.map((e) => e.host_id))];
  const hosts = new Map<string, string>();
  if (hostIds.length > 0) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", hostIds);
    (profs ?? []).forEach((p) => hosts.set(p.id, p.full_name ?? ""));
  }

  const items: AdminEvent[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    location: e.location,
    startsAt: formatEventDate(e.starts_at),
    hostName: hosts.get(e.host_id) ?? null,
    attendeeCount: e.attendee_count ?? 0,
    status: e.status,
  }));

  return (
    <>
      <PageHeader title="Events" count={items.length} sub="Approve, reject or remove events." />

      <nav className="mb-4 flex flex-wrap gap-1 border-b border-glass-border">
        {FILTERS.map((f) => (
          <a
            key={f}
            href={`/admin/events?status=${f}`}
            className={
              f === status
                ? "-mb-px border-b-2 border-fg px-3 py-1.5 text-xs font-medium text-fg"
                : "px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
            }
          >
            {f}
          </a>
        ))}
      </nav>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="rounded-[4px] border border-glass-border px-4 py-3 text-sm text-fg-muted">
            No {status === "all" ? "" : status} events.
          </p>
        ) : (
          items.map((e) => <EventAdminRow key={e.id} event={e} isSuper={isSuper} />)
        )}
      </div>
    </>
  );
}
