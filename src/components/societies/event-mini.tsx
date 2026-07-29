import Link from "next/link";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import type { SocietyEvent } from "@/lib/societies/queries";

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Compact event card linking into the existing event detail page. When the
 * event has a pinned location, the location line is a SEPARATE link out to
 * `/map?place=` (an `<a>` can't nest inside the card's own `<a>`), sitting
 * beside the main card link rather than inside it.
 */
export function EventMini({ event }: { event: SocietyEvent }) {
  return (
    <div className="flex gap-3 overflow-hidden rounded-[14px] bg-card p-3">
      <Link href={`/events/${event.id}`} className="flex min-w-0 flex-1 gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-white/5">
          {event.cover_url ? (
            <AppImage src={event.cover_url} alt="" sizes="64px" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-fg-muted">
              <CalendarDays className="h-6 w-6" aria-hidden />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{event.title}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-accent">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {fmt(event.starts_at)}
          </p>
          <div className="mt-1 flex items-center gap-3 text-xs text-fg-muted">
            {event.location && !event.place_id && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{event.location}</span>
              </span>
            )}
            <span className="flex shrink-0 items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {event.attendee_count}
              {event.capacity ? `/${event.capacity}` : ""}
            </span>
          </div>
        </div>
      </Link>
      {event.location && event.place_id && (
        <Link
          href={`/map?place=${encodeURIComponent(event.place_id)}`}
          className="mt-auto flex shrink-0 items-center gap-1 self-start text-xs font-medium text-aura hover:underline"
        >
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="max-w-[90px] truncate">{event.location}</span>
        </Link>
      )}
    </div>
  );
}
