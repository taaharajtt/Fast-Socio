import Link from "next/link";
import { GlassCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { eventBadge } from "@/lib/events/format";

type UpcomingEvent = {
  id: string;
  title: string;
  category: string;
  starts_at: string;
  attendee_count: number;
};

/** Horizontal "Upcoming events" carousel for the Home feed (UI Spec §5.4). */
export async function EventsStrip() {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("events")
    .select("id, title, category, starts_at, attendee_count")
    .eq("status", "approved")
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(8);
  const events = (data as UpcomingEvent[]) ?? [];

  if (events.length === 0) return null;

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-fg-muted">Upcoming events</h2>
        <Link href="/events" className="text-xs text-aura">
          See all
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {events.map((e) => {
          const b = eventBadge(e.starts_at);
          return (
            <Link key={e.id} href={`/events/${e.id}`} className="shrink-0">
              <GlassCard className="w-40 p-3">
                <div className="flex items-center gap-2">
                  <div className="glass flex h-10 w-10 flex-col items-center justify-center rounded-xl">
                    <span className="text-sm font-bold leading-none">
                      {b.day}
                    </span>
                    <span className="text-[9px] text-fg-muted">{b.month}</span>
                  </div>
                  <span className="text-[11px] text-cyan">{e.category}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-semibold">
                  {e.title}
                </p>
                <p className="mt-1 text-[11px] text-fg-muted">
                  {e.attendee_count} going
                </p>
              </GlassCard>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
