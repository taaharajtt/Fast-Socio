import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AttendeeList, type Attendee } from "@/components/events/attendee-list";

type AttendeeRow = {
  user_id: string;
  checked_in_at: string | null;
  user: {
    id: string;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
};

/**
 * Full "who's going" list for an event — viewable by any signed-in student
 * (event_attendees SELECT is open, matching the public attendee count). The
 * list is scrollable and searchable by display name; each row links to the
 * attendee's profile.
 */
export default async function EventAttendeesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("id, title")
    .eq("id", id)
    .single();
  if (!event) notFound();

  const { data: rows } = await supabase
    .from("event_attendees")
    .select(
      "user_id, checked_in_at, user:profiles(id, full_name, username, avatar_url)"
    )
    .eq("event_id", id)
    .order("created_at", { ascending: true })
    .limit(1000);

  const attendees: Attendee[] = ((rows as unknown as AttendeeRow[]) ?? [])
    .filter((r) => r.user)
    .map((r) => ({
      id: r.user!.id,
      full_name: r.user!.full_name,
      username: r.user!.username,
      avatar_url: r.user!.avatar_url,
      checked_in: r.checked_in_at != null,
    }));

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-md flex-col px-5 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/events/${id}`}
          aria-label="Back"
          className="glass flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">Going</h1>
          <p className="truncate text-xs text-fg-muted">{event.title}</p>
        </div>
      </div>

      <AttendeeList attendees={attendees} />
    </main>
  );
}
