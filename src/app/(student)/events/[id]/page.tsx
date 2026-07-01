import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Calendar, MapPin, Users } from "lucide-react";
import { GlassCard, GlassChip } from "@/components/ui";
import { RsvpButton } from "@/components/events/rsvp-button";
import { createClient } from "@/lib/supabase/server";
import { formatEventDate } from "@/lib/events/format";

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
      "id, title, description, category, location, starts_at, attendee_count, status, host_id"
    )
    .eq("id", id)
    .single();
  if (!event) notFound();

  const { data: attendance } = await supabase
    .from("event_attendees")
    .select("event_id")
    .eq("event_id", id)
    .eq("user_id", me)
    .maybeSingle();

  const attending = Boolean(attendance);
  const pending = event.status !== "approved";

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
        </div>
        <h2 className="mt-3 text-2xl font-bold">{event.title}</h2>

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
          </p>
        </div>

        {event.description && (
          <p className="mt-4 whitespace-pre-wrap text-[15px]">
            {event.description}
          </p>
        )}

        {!pending && (
          <div className="mt-5">
            <RsvpButton eventId={event.id} attending={attending} />
          </div>
        )}
        {pending && (
          <p className="mt-5 text-sm text-fg-muted">
            This event is awaiting admin approval.
          </p>
        )}
      </GlassCard>
    </main>
  );
}
