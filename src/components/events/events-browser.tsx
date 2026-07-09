"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, MapPin } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { EVENT_CATEGORIES } from "@/lib/events/constants";

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

export function EventsBrowser({ events }: { events: EventVM[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");

  // Brief shimmer when the category tab changes (UAT-013) so switching feels
  // smooth even though filtering is instant.
  const [switching, setSwitching] = useState(false);
  const firstCat = useRef(true);
  useEffect(() => {
    if (firstCat.current) {
      firstCat.current = false;
      return;
    }
    setSwitching(true);
    const t = setTimeout(() => setSwitching(false), 350);
    return () => clearTimeout(t);
  }, [category]);

  const featured = events.slice(0, 4);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (category !== "All" && e.category !== category) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.organizer.toLowerCase().includes(q) ||
        (e.location?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [events, query, category]);

  return (
    <>
      {/* Search bar (UISpec V3 Screen 9). */}
      <div className="relative mt-4">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-fg-muted"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search events..."
          aria-label="Search events"
          className="h-12 w-full rounded-xl bg-card pl-11 pr-4 text-[15px] text-fg placeholder:text-fg-disabled outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      {/* Upcoming — featured 2-column grid. Hidden while searching so results
          read as a single focused list. */}
      {query.trim() === "" && featured.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-[17px] font-bold">Upcoming</h2>
          <div className="grid grid-cols-2 gap-3">
            {featured.map((e) => (
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

      {/* Browse by Category. */}
      <section className="mt-6">
        <h2 className="mb-3 text-[17px] font-bold">Browse by Category</h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {["All", ...EVENT_CATEGORIES].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                "shrink-0 rounded-full px-4 py-2 text-sm transition-colors active:scale-95",
                category === c
                  ? "bg-accent font-semibold text-white"
                  : "border border-white/[0.08] bg-card font-medium text-fg-muted hover:text-fg"
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          {switching ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-[14px] bg-card p-3">
                <Skeleton className="h-[72px] w-[72px] shrink-0 rounded-[10px]" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </div>
              </div>
            ))
          ) : filtered.length === 0 ? (
            <p className="rounded-[14px] bg-card p-6 text-center text-sm text-fg-muted">
              No events found
              {category !== "All" ? ` in ${category}` : ""}
              {query.trim() ? ` for “${query.trim()}”` : ""}.
            </p>
          ) : (
            filtered.map((e) => (
              <Link
                key={e.id}
                href={`/events/${e.id}`}
                className="flex items-center gap-3 rounded-[14px] bg-card p-3"
              >
                <Banner
                  event={e}
                  className="h-[72px] w-[72px] shrink-0 rounded-[10px]"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-fg">
                    {e.title}
                  </p>
                  <p className="truncate text-xs text-fg-muted">
                    by {e.organizer}
                  </p>
                  <p className="mt-1 flex items-center gap-1 truncate text-xs text-fg-muted">
                    {e.location && (
                      <>
                        <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                        {e.location}
                        <span aria-hidden>·</span>
                      </>
                    )}
                    {e.attendee_count} going
                  </p>
                </div>
                <DateBadge day={e.day} month={e.month} />
              </Link>
            ))
          )}
        </div>
      </section>
    </>
  );
}
