"use client";

import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { SocietyBrowser } from "@/components/societies/society-browser";
import type { SocietyCardVM } from "@/lib/societies/types";
import { cn } from "@/lib/utils";

/** Serializable event view-model prepared on the server (badge + organizer are
 *  precomputed there because the date formatter is server-only). */
export type EventVM = {
  id: string;
  title: string;
  category: string;
  location: string | null;
  cover_url: string | null;
  attendee_count: number;
  organizer: string;
  day: string;
  month: string;
};

/** Deterministic banner gradient per category, used when an event has no cover
 *  image (UISpec V3 featured cards are image-led; this keeps them on-brand). */
const CAT_GRADIENT: Record<string, [string, string]> = {
  Social: ["#7c3aed", "#a855f7"],
  Tech: ["#2563eb", "#7c3aed"],
  Academic: ["#0ea5e9", "#6366f1"],
  Sports: ["#f97316", "#ef4444"],
  Music: ["#a855f7", "#ec4899"],
  Arts: ["#ec4899", "#f97316"],
  Career: ["#0d9488", "#2563eb"],
  Gaming: ["#7c3aed", "#22c55e"],
  Food: ["#f59e0b", "#ef4444"],
};

function gradient(category: string): string {
  const [a, b] = CAT_GRADIENT[category] ?? ["#7c3aed", "#a855f7"];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function DateBadge({ day, month }: { day: string; month: string }) {
  return (
    <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-white">
      {day} {month}
    </span>
  );
}

/** Cover image or a category-tinted gradient fallback with the title overlaid. */
function Banner({ event, className }: { event: EventVM; className?: string }) {
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={event.cover_url ? undefined : { background: gradient(event.category) }}
    >
      {event.cover_url && (
        <AppImage
          src={event.cover_url}
          alt={event.title}
          sizes="(max-width: 448px) 50vw, 224px"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
    </div>
  );
}

/**
 * The Community surface (dock tab "Community", route /events): upcoming events
 * as featured cards on top, the campus societies browser below.
 *
 * The old "Browse by Category" event list — and the event search bar that fed
 * it — were replaced by the societies browser, which brings its own search and
 * filters. The featured grid now renders every upcoming event rather than the
 * first four, so nothing is stranded by the list's removal.
 */
export function EventsBrowser({
  events,
  societies,
}: {
  events: EventVM[];
  societies: SocietyCardVM[];
}) {
  return (
    <>
      {events.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-[17px] font-bold">Upcoming Events</h2>
          <div className="grid grid-cols-2 gap-3">
            {events.map((e) => (
              <Link key={e.id} href={`/events/${e.id}`} className="block">
                <div className="relative">
                  <Banner event={e} className="h-40 rounded-2xl" />
                  <div className="absolute left-3 top-3">
                    <DateBadge day={e.day} month={e.month} />
                  </div>
                  <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2 py-1 text-[11px] text-white">
                    {e.attendee_count} going
                  </span>
                </div>
                <p className="mt-2 truncate text-sm font-semibold text-fg">
                  {e.title}
                </p>
                <p className="truncate text-xs text-fg-muted">
                  by {e.organizer}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Campus societies — replaces the old "Browse by Category" event list.
          SocietyBrowser owns its own search, status flags and category chips. */}
      <section className="mt-8">
        <h2 className="text-[17px] font-bold">Campus Societies</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Explore and follow the societies running campus life.
        </p>
        {societies.length === 0 ? (
          <p className="mt-4 rounded-[14px] bg-card p-6 text-center text-sm text-fg-muted">
            No societies yet.
          </p>
        ) : (
          <SocietyBrowser societies={societies} />
        )}
      </section>

    </>
  );
}
