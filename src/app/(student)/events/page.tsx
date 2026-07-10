import Link from "next/link";
import { Plus, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { eventBadge } from "@/lib/events/format";
import { EventsBrowser, type EventVM } from "@/components/events/events-browser";

type EventRow = {
  id: string;
  title: string;
  category: string;
  location: string | null;
  cover_url: string | null;
  starts_at: string;
  attendee_count: number;
  status: string;
  host_id: string;
  community_id: string | null;
};

export default async function EventsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const [{ data: rows }, { data: meProfile }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, title, category, location, cover_url, starts_at, attendee_count, status, host_id, community_id"
      )
      .order("starts_at", { ascending: true }),
    supabase.from("profiles").select("full_name").eq("id", me).single(),
  ]);

  // UAT-013: opening this page clears the dock's "new events" badge. The layout
  // has already counted for this render, so the badge clears on the next one.
  await supabase.rpc("touch_events_seen");

  const events = (rows ?? []) as EventRow[];
  const approved = events.filter((e) => e.status === "approved");
  const myPending = events.filter(
    (e) => e.status === "pending" && e.host_id === me
  );

  // Resolve organizer names: prefer the hosting community, else the host.
  const hostIds = [...new Set(approved.map((e) => e.host_id))];
  const communityIds = [
    ...new Set(approved.map((e) => e.community_id).filter(Boolean) as string[]),
  ];
  const [{ data: hosts }, { data: comms }] = await Promise.all([
    hostIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", hostIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    communityIds.length
      ? supabase.from("communities").select("id, name").in("id", communityIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const hostName = new Map((hosts ?? []).map((h) => [h.id, h.full_name]));
  const commName = new Map((comms ?? []).map((c) => [c.id, c.name]));

  const vms: EventVM[] = approved.map((e) => {
    const b = eventBadge(e.starts_at);
    const organizer =
      (e.community_id && commName.get(e.community_id)) ||
      hostName.get(e.host_id) ||
      "FAST Socio";
    return {
      id: e.id,
      title: e.title,
      category: e.category,
      location: e.location,
      cover_url: e.cover_url,
      attendee_count: e.attendee_count,
      organizer,
      day: b.day,
      month: b.month,
    };
  });

  const firstName = meProfile?.full_name?.split(" ")[0];

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Events</h1>
          <p className="mt-1 text-sm text-fg-muted">
            What do you want to do{firstName ? `, ${firstName}` : ""}?
          </p>
        </div>
        <Link
          href="/events/new"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-fg-muted hover:text-fg"
          aria-label="Create event"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </Link>
      </div>

      {myPending.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-medium text-fg-muted">
            Awaiting approval
          </h2>
          <div className="space-y-2">
            {myPending.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded-[14px] bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{e.title}</p>
                  <p className="text-xs text-fg-muted">Pending admin review</p>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning">
                  <Clock className="h-3 w-3" aria-hidden /> pending
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <EventsBrowser events={vms} />
    </main>
  );
}
