import Link from "next/link";
import { Plus, Clock } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { eventBadge } from "@/lib/events/format";
import { EVENT_CATEGORIES } from "@/lib/events/constants";

type EventRow = {
  id: string;
  title: string;
  category: string;
  location: string | null;
  starts_at: string;
  attendee_count: number;
  status: string;
  host_id: string;
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  let query = supabase
    .from("events")
    .select("id, title, category, location, starts_at, attendee_count, status, host_id")
    .order("starts_at", { ascending: true });
  if (category) query = query.eq("category", category);

  const { data: rows } = await query;
  const events = (rows ?? []) as EventRow[];
  const approved = events.filter((e) => e.status === "approved");
  const myPending = events.filter(
    (e) => e.status === "pending" && e.host_id === me
  );

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Events</h1>
        <Link
          href="/events/new"
          className="glass flex h-10 w-10 items-center justify-center rounded-full text-fg-muted hover:text-fg"
          aria-label="Create event"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </Link>
      </div>

      {/* Category filter */}
      <nav className="mt-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Link
          href="/events"
          className={
            !category
              ? "shrink-0 rounded-full bg-aura px-4 py-1.5 text-sm text-white"
              : "glass shrink-0 rounded-full px-4 py-1.5 text-sm text-fg-muted"
          }
        >
          All
        </Link>
        {EVENT_CATEGORIES.map((cat) => (
          <Link
            key={cat}
            href={`/events?category=${cat}`}
            className={
              category === cat
                ? "shrink-0 rounded-full bg-aura px-4 py-1.5 text-sm text-white"
                : "glass shrink-0 rounded-full px-4 py-1.5 text-sm text-fg-muted"
            }
          >
            {cat}
          </Link>
        ))}
      </nav>

      {myPending.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-medium text-fg-muted">
            Awaiting approval
          </h2>
          <div className="space-y-2">
            {myPending.map((e) => (
              <GlassCard key={e.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{e.title}</p>
                  <p className="text-xs text-fg-muted">Pending admin review</p>
                </div>
                <GlassChip tone="warning">
                  <Clock className="mr-1 h-3 w-3" aria-hidden /> pending
                </GlassChip>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      <section className="mt-5 space-y-3">
        {approved.length === 0 ? (
          <GlassCard className="p-5">
            <p className="text-sm text-fg-muted">
              No upcoming events{category ? ` in ${category}` : ""} yet.
            </p>
          </GlassCard>
        ) : (
          approved.map((e) => {
            const b = eventBadge(e.starts_at);
            return (
              <Link key={e.id} href={`/events/${e.id}`} className="block">
                <GlassCard className="flex items-center gap-4 p-4">
                  <div className="glass flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl">
                    <span className="text-lg font-bold leading-none">
                      {b.day}
                    </span>
                    <span className="text-[10px] text-fg-muted">{b.month}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.title}</p>
                    <p className="truncate text-xs text-fg-muted">
                      {e.category}
                      {e.location ? ` · ${e.location}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-aura">
                      {e.attendee_count} going
                    </p>
                  </div>
                </GlassCard>
              </Link>
            );
          })
        )}
      </section>
    </main>
  );
}
