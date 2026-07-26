import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { EventMini } from "@/components/societies/event-mini";
import type { SocietyEvent } from "@/lib/societies/queries";

export function EventsTab({
  societyId,
  upcoming,
  past,
  canManage,
}: {
  societyId: string;
  upcoming: SocietyEvent[];
  past: SocietyEvent[];
  canManage: boolean;
}) {
  const empty = upcoming.length === 0 && past.length === 0;

  return (
    <div className="space-y-6">
      {canManage && (
        <Link
          href={`/events/new?communityId=${societyId}`}
          className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white active:scale-95"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Create an event
        </Link>
      )}

      {empty ? (
        <div className="rounded-[14px] bg-card px-5 py-10 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-fg-muted" aria-hidden />
          <p className="mt-3 font-semibold text-fg">
            No events hosted by this society yet
          </p>
        </div>
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-fg">Upcoming</h2>
            {upcoming.length === 0 ? (
              <p className="rounded-[14px] bg-card px-4 py-6 text-center text-sm text-fg-muted">
                No upcoming events yet.
              </p>
            ) : (
              <div className="space-y-2">
                {upcoming.map((e) => (
                  <EventMini key={e.id} event={e} />
                ))}
              </div>
            )}
          </section>

          {past.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-fg">Past events</h2>
              <div className="space-y-2 opacity-80">
                {past.map((e) => (
                  <EventMini key={e.id} event={e} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
