import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  Calendar,
  MapPin,
  Users,
  Star,
  QrCode,
} from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { AppImage } from "@/components/ui/app-image";
import { RsvpButton, type RsvpState } from "@/components/events/rsvp-button";
import { EventTicket } from "@/components/events/event-ticket";
import {
  EventDiscussion,
  type EventMessage,
} from "@/components/events/event-discussion";
import { EventFeedback } from "@/components/events/event-feedback";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate, eventBadge } from "@/lib/events/format";
import { checkInQrDataUrl } from "@/lib/events/qr";

/** Whether an event's end (or start, if open-ended) is in the past. */
function hasEnded(startsAt: string, endsAt: string | null): boolean {
  return new Date(endsAt ?? startsAt).getTime() < Date.now();
}

type DiscussionRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender: { full_name: string | null; avatar_url: string | null } | null;
};

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user!.id;

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, description, category, location, starts_at, ends_at, attendee_count, capacity, status, host_id"
    )
    .eq("id", id)
    .single();
  if (!event) notFound();

  const ended = hasEnded(event.starts_at, event.ends_at);
  const pending = event.status !== "approved";
  const isHost = event.host_id === me;

  const [
    { data: attendance },
    { data: waitrow },
    { data: host },
    { data: rating },
    { data: myFeedback },
    { data: discussionRows },
  ] = await Promise.all([
    supabase
      .from("event_attendees")
      .select("check_in_code, checked_in_at")
      .eq("event_id", id)
      .eq("user_id", me)
      .maybeSingle(),
    supabase
      .from("event_waitlist")
      .select("event_id")
      .eq("event_id", id)
      .eq("user_id", me)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .eq("id", event.host_id)
      .single(),
    supabase.rpc("get_organizer_rating", { p_host: event.host_id }),
    ended
      ? supabase
          .from("event_feedback")
          .select("rating, comment")
          .eq("event_id", id)
          .eq("user_id", me)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("event_messages")
      .select("id, sender_id, body, created_at, sender:profiles(full_name, avatar_url)")
      .eq("event_id", id)
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  const attending = Boolean(attendance);
  const waitlisted = !attending && Boolean(waitrow);
  const rsvpState: RsvpState = attending
    ? "going"
    : waitlisted
      ? "waitlisted"
      : "none";
  const checkedIn = Boolean(attendance?.checked_in_at);

  const ratingRow = (rating as { avg_rating: number | null; review_count: number }[] | null)?.[0];

  // The check-in QR is only useful before the event ends and only to the holder.
  const qrDataUrl =
    attending && !ended && attendance?.check_in_code
      ? await checkInQrDataUrl(attendance.check_in_code)
      : null;

  const messages: EventMessage[] = ((discussionRows as unknown as DiscussionRow[]) ?? []).map(
    (r) => ({
      id: r.id,
      sender_id: r.sender_id,
      body: r.body,
      created_at: r.created_at,
      sender_name: r.sender?.full_name ?? null,
      sender_avatar: r.sender?.avatar_url ?? null,
    })
  );

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/events"
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="truncate text-lg font-bold">Event</h1>
      </div>

      <GlassCard radius="card" className="p-5">
        <div className="flex items-center gap-2">
          <GlassChip tone="cyan">{event.category}</GlassChip>
          {pending && <GlassChip tone="warning">pending</GlassChip>}
          {!pending && ended && <GlassChip>ended</GlassChip>}
        </div>

        <div className="mt-3 flex items-start justify-between gap-3">
          <h2 className="text-2xl font-bold">{event.title}</h2>
          {(() => {
            const b = eventBadge(event.starts_at);
            return (
              <div className="gradient-brand flex shrink-0 flex-col items-center rounded-[var(--radius-md)] px-3 py-2 text-center shadow-[0_8px_24px_rgba(200,80,192,0.4)]">
                <span className="text-xl font-extrabold leading-none text-white">
                  {b.day}
                </span>
                <span className="mt-0.5 text-[11px] text-white/75">{b.month}</span>
              </div>
            );
          })()}
        </div>

        <div className="mt-4 space-y-2 text-sm text-fg-muted">
          <p className="flex items-center gap-2">
            <Calendar className="h-4 w-4" aria-hidden />
            {formatEventDate(event.starts_at)}
          </p>
          {event.location && (
            <p className="flex items-center gap-2">
              <MapPin className="h-4 w-4" aria-hidden />
              {event.location}
            </p>
          )}
          <p className="flex items-center gap-2">
            <Users className="h-4 w-4" aria-hidden />
            {event.attendee_count} going
            {event.capacity != null && ` · capacity ${event.capacity}`}
          </p>
        </div>

        {event.description && (
          <p className="mt-4 whitespace-pre-wrap text-[15px]">
            {event.description}
          </p>
        )}

        {!pending && (
          <div className="mt-5">
            <RsvpButton
              eventId={event.id}
              initialState={rsvpState}
              count={event.attendee_count}
              capacity={event.capacity}
              ended={ended}
            />
          </div>
        )}
        {pending && (
          <p className="mt-5 text-sm text-fg-muted">
            This event is awaiting admin approval.
          </p>
        )}
      </GlassCard>

      {/* Organizer row + reputation. */}
      {host && (
        <Link href={`/profile/${host.id}`} className="mt-3 block">
          <GlassCard className="flex items-center gap-3 p-4">
            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-bg-elevated">
              {host.avatar_url && (
                <AppImage src={host.avatar_url} alt="" sizes="40px" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-fg-muted">Organized by</p>
              <p className="truncate text-sm font-semibold text-fg">
                {host.full_name ?? "Organizer"}
              </p>
            </div>
            {ratingRow?.avg_rating != null && (
              <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-gold">
                <Star className="h-4 w-4 fill-gold" aria-hidden />
                {ratingRow.avg_rating}
                <span className="text-xs font-normal text-fg-muted">
                  ({ratingRow.review_count})
                </span>
              </span>
            )}
          </GlassCard>
        </Link>
      )}

      {/* Organizer check-in entry. */}
      {isHost && !pending && (
        <Link href={`/events/${id}/check-in`} className="mt-3 block">
          <GlassCard className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full gradient-brand">
              <QrCode className="h-5 w-5 text-white" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">Check-in console</p>
              <p className="text-xs text-fg-muted">
                Validate attendee codes at the door
              </p>
            </div>
          </GlassCard>
        </Link>
      )}

      {/* Attendee's own check-in pass. */}
      {attending && !ended && (
        <div className="mt-3">
          <EventTicket
            qrDataUrl={qrDataUrl}
            code={attendance!.check_in_code}
            checkedIn={checkedIn}
          />
        </div>
      )}

      {/* Post-event feedback for attendees. */}
      {ended && attending && (
        <div className="mt-3">
          <EventFeedback
            eventId={id}
            initialRating={
              (myFeedback as { rating: number } | null)?.rating ?? null
            }
            initialComment={
              (myFeedback as { comment: string | null } | null)?.comment ?? null
            }
          />
        </div>
      )}

      {/* Discussion — visible to attendees (and host/admin via RLS). */}
      {!pending && (attending || isHost) && (
        <section className="mt-5">
          <h3 className="mb-1 text-sm font-semibold text-fg">Discussion</h3>
          <EventDiscussion
            eventId={id}
            meId={me}
            canPost={attending}
            initialMessages={messages}
          />
        </section>
      )}
    </main>
  );
}
