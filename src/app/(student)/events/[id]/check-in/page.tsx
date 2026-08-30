import { Suspense } from "react";
import { RouteFallback } from "@/components/ui/route-fallback";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { CheckInScanner } from "@/components/events/check-in-scanner";

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
export default function EventCheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <EventCheckInPageBody params={params} />
    </Suspense>
  );
}

/** Organizer-only check-in console for an event (Refactor Phase 6). */
async function EventCheckInPageBody({
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
    .select("id, title, host_id, capacity")
    .eq("id", id)
    .single();
  if (!event) notFound();

  const [{ data: profile }, { data: coOrg }] = await Promise.all([
    supabase.from("profiles").select("is_admin").eq("id", me).single(),
    supabase
      .from("event_organizers")
      .select("user_id")
      .eq("event_id", id)
      .eq("user_id", me)
      .maybeSingle(),
  ]);
  const isOrganizer =
    event.host_id === me || Boolean(coOrg) || profile?.is_admin === true;
  if (!isOrganizer) redirect(`/events/${id}`);

  const [{ count: attendees }, { count: checkedIn }] = await Promise.all([
    supabase
      .from("event_attendees")
      .select("event_id", { count: "exact", head: true })
      .eq("event_id", id),
    supabase
      .from("event_attendees")
      .select("event_id", { count: "exact", head: true })
      .eq("event_id", id)
      .not("checked_in_at", "is", null),
  ]);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/events/${id}`}
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="truncate text-lg font-bold">Check-in</h1>
      </div>

      <div className="mb-5 rounded-[var(--radius-card)] bg-card p-5">
        <p className="text-sm text-fg-muted">{event.title}</p>
        <p className="mt-1 text-2xl font-bold text-fg">
          {checkedIn ?? 0}
          <span className="text-fg-muted">
            {" "}
            / {attendees ?? 0} checked in
          </span>
        </p>
      </div>

      <CheckInScanner eventId={id} />
    </main>
  );
}
