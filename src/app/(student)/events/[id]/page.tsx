import { Suspense } from "react";
import PageLoading from "./loading";
import { notFound } from "next/navigation";
import { EventShell, type EventShellTab } from "@/components/events/event-shell";
import { EventOverviewTab } from "@/components/events/tabs/event-overview-tab";
import { EventMembersTab } from "@/components/events/tabs/event-members-tab";
import type { RsvpState } from "@/components/events/rsvp-button";
import type { Organizer } from "@/components/events/event-host-controls";
import type { EventMessage } from "@/components/events/event-discussion";
import type { Attendee } from "@/components/events/attendee-list";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { formatEventDate } from "@/lib/events/format";
import { getSocialProof } from "@/lib/communities/social-proof";
import { checkInQrDataUrl } from "@/lib/events/qr";
import { resolveAvatarUrl } from "@/lib/avatar";

/** Whether an event's end (or start, if open-ended) is in the past. */
function hasEnded(startsAt: string, endsAt: string | null): boolean {
  return new Date(endsAt ?? startsAt).getTime() < Date.now();
}

type DiscussionRow = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender: { full_name: string | null; avatar_url: string | null; gender: string | null } | null;
};

type AttendeeRow = {
  user_id: string;
  checked_in_at: string | null;
  user: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; gender: string | null } | null;
};

/**
 * PERF/CORRECTNESS (perf audit Phase 4) — this default export is deliberately
 * NOT async and never awaits `params`/`searchParams`. Under Cache Components,
 * reading request data (or calling `notFound()`) at the top level makes the
 * route dynamic while Next is still building its fallback shell; resuming that
 * shell then throws
 *
 *   InvariantError: postponed state should not be provided when fallback
 *   params are provided        (E592)
 *
 * which surfaces as a 500. The request-scoped work lives in the async body
 * below, behind a Suspense boundary. Same shape as /post/[id], which hit this
 * exact bug first and documents it.
 */
export default function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EventPageBody params={params} />
    </Suspense>
  );
}

async function EventPageBody({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const userId = await getAuthUserId();
  const me = userId!;

  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, description, category, location, place_id, starts_at, ends_at, cover_url, attendee_count, capacity, status, host_id, community_id"
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
    { data: community },
    { data: rating },
    { data: myFeedback },
    { data: discussionRows },
    { data: organizerRows },
    { data: attendeeRows },
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
    supabase.from("profiles").select("id, full_name, avatar_url, gender").eq("id", event.host_id).single(),
    event.community_id
      ? supabase
          .from("communities")
          .select("id, name, is_society")
          .eq("id", event.community_id)
          .single()
      : Promise.resolve({ data: null }),
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
      .select("id, sender_id, body, created_at, sender:profiles(full_name, avatar_url, gender)")
      .eq("event_id", id)
      .order("created_at", { ascending: true })
      .limit(100),
    supabase
      .from("event_organizers")
      .select(
        "user_id, user:profiles!event_organizers_user_id_fkey(id, full_name, username, avatar_url, gender)"
      )
      .eq("event_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("event_attendees")
      .select("user_id, checked_in_at, user:profiles(id, full_name, username, avatar_url, gender)")
      .eq("event_id", id)
      .order("created_at", { ascending: true })
      .limit(1000),
  ]);

  const organizers: Organizer[] = (
    (organizerRows as unknown as { user: Organizer | null }[]) ?? []
  )
    .map((r) => r.user)
    .filter((u): u is Organizer => Boolean(u));
  const isOrganizer = isHost || organizers.some((o) => o.id === me);

  const attending = Boolean(attendance);
  const waitlisted = !attending && Boolean(waitrow);
  const rsvpState: RsvpState = attending ? "going" : waitlisted ? "waitlisted" : "none";
  const checkedIn = Boolean(attendance?.checked_in_at);

  const ratingRow = (rating as { avg_rating: number | null; review_count: number }[] | null)?.[0] ?? null;

  const qrDataUrl =
    attending && !ended && attendance?.check_in_code
      ? await checkInQrDataUrl(attendance.check_in_code)
      : null;

  const discussionMessages: EventMessage[] = ((discussionRows as unknown as DiscussionRow[]) ?? []).map(
    (r) => ({
      id: r.id,
      sender_id: r.sender_id,
      body: r.body,
      created_at: r.created_at,
      sender_name: r.sender?.full_name ?? null,
      sender_avatar: resolveAvatarUrl(r.sender?.avatar_url, r.sender?.gender),
    })
  );

  const attendees: Attendee[] = ((attendeeRows as unknown as AttendeeRow[]) ?? [])
    .filter((r) => r.user)
    .map((r) => ({
      id: r.user!.id,
      full_name: r.user!.full_name,
      username: r.user!.username,
      avatar_url: r.user!.avatar_url,
      gender: r.user!.gender,
      checked_in: r.checked_in_at != null,
    }));

  // Cover social proof, ranked from the attendee list already loaded above.
  const proof = await getSocialProof(
    attendees.map((a) => a.id),
    event.attendee_count,
    me
  );

  const tabs: EventShellTab[] = [
    {
      key: "overview",
      label: "Overview",
      content: (
        <EventOverviewTab
          eventId={id}
          meId={me}
          description={event.description}
          formattedDate={formatEventDate(event.starts_at)}
          location={event.location}
          placeId={event.place_id}
          attendeeCount={event.attendee_count}
          capacity={event.capacity}
          host={host ?? null}
          organizerRating={ratingRow}
          organizers={organizers}
          isHost={isHost}
          isOrganizer={isOrganizer}
          ended={ended}
          pending={pending}
          attending={attending}
          checkedIn={checkedIn}
          qrDataUrl={qrDataUrl}
          checkInCode={attendance?.check_in_code ?? null}
          feedback={{
            rating: (myFeedback as { rating: number } | null)?.rating ?? null,
            comment: (myFeedback as { comment: string | null } | null)?.comment ?? null,
          }}
          discussionMessages={discussionMessages}
          canDiscuss={!pending && (attending || isOrganizer)}
        />
      ),
    },
    {
      key: "members",
      label: "Members",
      content: <EventMembersTab attendees={attendees} />,
    },
  ];

  return (
    <EventShell
      event={{
        id: event.id,
        title: event.title,
        category: event.category,
        cover_url: event.cover_url,
        hostName: community?.name ?? host?.full_name ?? null,
        hostHref:
          community && community.is_society
            ? `/societies/${community.id}`
            : host
              ? `/profile/${host.id}`
              : null,
        pending,
        ended,
      }}
      rsvp={{ initialState: rsvpState, count: event.attendee_count, capacity: event.capacity }}
      proof={proof}
      tabs={tabs}
    />
  );
}
