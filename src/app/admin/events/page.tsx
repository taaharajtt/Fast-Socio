import { EventModRow, type PendingEvent } from "@/components/admin/event-mod-row";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate } from "@/lib/events/format";

export default async function AdminEventsPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("events")
    .select("id, title, category, location, starts_at, host_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const events = rows ?? [];

  const hostIds = [...new Set(events.map((e) => e.host_id))];
  const hosts = new Map<string, string>();
  if (hostIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", hostIds);
    (profs ?? []).forEach((p) => hosts.set(p.id, p.full_name ?? ""));
  }

  const items: PendingEvent[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    location: e.location,
    startsAt: formatEventDate(e.starts_at),
    hostName: hosts.get(e.host_id) ?? null,
  }));

  return (
    <main>
      <h1 className="text-2xl font-bold tracking-tight">Events</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {items.length} pending approval
      </p>
      <div className="mt-5 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-fg-muted">Nothing to review.</p>
        ) : (
          items.map((e) => <EventModRow key={e.id} event={e} />)
        )}
      </div>
    </main>
  );
}
