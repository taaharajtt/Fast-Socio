import Link from "next/link";
import { Calendar, MapPin, QrCode, Star, Users } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { EventTicket } from "@/components/events/event-ticket";
import {
  EventHostControls,
  type Organizer,
} from "@/components/events/event-host-controls";
import { EventDiscussion, type EventMessage } from "@/components/events/event-discussion";
import { EventFeedback } from "@/components/events/event-feedback";

/**
 * Date, time, location, description, check-in ticket, host controls, and
 * post-event feedback — everything the spec's "Key Details Grid" and the
 * surrounding action boxes call for. The attendee discussion (event_messages)
 * isn't named in the new tab spec but is existing, shipped functionality with
 * no other home in the new shell, so it stays here rather than being dropped.
 */
export function EventOverviewTab({
  eventId,
  meId,
  description,
  formattedDate,
  location,
  attendeeCount,
  capacity,
  host,
  organizerRating,
  organizers,
  isHost,
  isOrganizer,
  ended,
  pending,
  attending,
  checkedIn,
  qrDataUrl,
  checkInCode,
  feedback,
  discussionMessages,
  canDiscuss,
}: {
  eventId: string;
  meId: string;
  description: string | null;
  formattedDate: string;
  location: string | null;
  attendeeCount: number;
  capacity: number | null;
  host: { id: string; full_name: string | null; avatar_url: string | null } | null;
  organizerRating: { avg_rating: number | null; review_count: number } | null;
  organizers: Organizer[];
  isHost: boolean;
  isOrganizer: boolean;
  ended: boolean;
  pending: boolean;
  attending: boolean;
  checkedIn: boolean;
  qrDataUrl: string | null;
  checkInCode: string | null;
  feedback: { rating: number | null; comment: string | null };
  discussionMessages: EventMessage[];
  canDiscuss: boolean;
}) {
  return (
    <div className="space-y-3">
      <GlassCard radius="card" className="p-5">
        <div className="space-y-2 text-sm text-fg-muted">
          <p className="flex items-center gap-2">
            <Calendar className="h-4 w-4" aria-hidden />
            {formattedDate}
          </p>
          {location && (
            <p className="flex items-center gap-2">
              <MapPin className="h-4 w-4" aria-hidden />
              {location}
            </p>
          )}
          <Link
            href={`/events/${eventId}/attendees`}
            className="-mx-1 flex items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:text-fg"
          >
            <Users className="h-4 w-4" aria-hidden />
            <span>
              {attendeeCount} going
              {capacity != null && ` · capacity ${capacity}`}
            </span>
          </Link>
        </div>

        {description && (
          <p className="mt-4 whitespace-pre-wrap text-[15px]">{description}</p>
        )}
      </GlassCard>

      {host && (
        <Link href={`/profile/${host.id}`} className="block">
          <GlassCard className="flex items-center gap-3 p-4">
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
              {host.avatar_url && <AppImage src={host.avatar_url} alt="" sizes="40px" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-fg-muted">Organized by</p>
              <p className="truncate text-sm font-semibold text-fg">
                {host.full_name ?? "Organizer"}
              </p>
            </div>
            {organizerRating?.avg_rating != null && (
              <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-gold">
                <Star className="h-4 w-4 fill-gold" aria-hidden />
                {organizerRating.avg_rating}
                <span className="text-xs font-normal text-fg-muted">
                  ({organizerRating.review_count})
                </span>
              </span>
            )}
          </GlassCard>
        </Link>
      )}

      {organizers.length > 0 && (
        <GlassCard className="p-4">
          <p className="text-xs text-fg-muted">Co-organizers</p>
          <div className="mt-2 space-y-2">
            {organizers.map((o) => (
              <Link key={o.id} href={`/profile/${o.id}`} className="flex items-center gap-3">
                <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
                  {o.avatar_url && <AppImage src={o.avatar_url} alt="" sizes="32px" />}
                </div>
                <span className="truncate text-sm font-medium text-fg">
                  {o.full_name ?? "Organizer"}
                </span>
              </Link>
            ))}
          </div>
        </GlassCard>
      )}

      {isHost && (
        <EventHostControls eventId={eventId} hostId={meId} initialOrganizers={organizers} />
      )}

      {isOrganizer && !pending && (
        <Link href={`/events/${eventId}/check-in`} className="block">
          <GlassCard className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gradient-brand">
              <QrCode className="h-5 w-5 text-white" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">Check-in console</p>
              <p className="text-xs text-fg-muted">Validate attendee codes at the door</p>
            </div>
          </GlassCard>
        </Link>
      )}

      {attending && !ended && (
        <EventTicket qrDataUrl={qrDataUrl} code={checkInCode ?? ""} checkedIn={checkedIn} />
      )}

      {ended && attending && (
        <EventFeedback
          eventId={eventId}
          initialRating={feedback.rating}
          initialComment={feedback.comment}
        />
      )}

      {!pending && canDiscuss && (
        <section>
          <h3 className="mb-1 text-sm font-semibold text-fg">Discussion</h3>
          <EventDiscussion
            eventId={eventId}
            meId={meId}
            canPost={canDiscuss}
            initialMessages={discussionMessages}
          />
        </section>
      )}
    </div>
  );
}
