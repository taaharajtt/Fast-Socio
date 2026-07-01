"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

/** Submit a new event for admin approval (status starts pending). */
export async function createEvent(input: {
  title: string;
  description: string;
  category: string;
  location: string;
  startsAt: string; // ISO datetime-local value
  communityId?: string | null;
}): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const title = input.title.trim();
  if (title.length < 2 || title.length > 120)
    return { error: "Title must be 2–120 characters." };
  if (!input.startsAt) return { error: "Pick a start date and time." };
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime()))
    return { error: "Invalid start date." };

  const allowed = await checkRateLimit("create_event", 10, 24 * 60 * 60);
  if (!allowed) return { error: "You've submitted too many events today." };

  const { data, error } = await supabase
    .from("events")
    .insert({
      host_id: user.id,
      community_id: input.communityId ?? null,
      title,
      description: input.description.trim() || null,
      category: input.category,
      location: input.location.trim() || null,
      starts_at: startsAt.toISOString(),
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  redirect(`/events/${data.id}`);
}

export async function rsvp(eventId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("event_attendees")
    .insert({ event_id: eventId, user_id: user.id });
  revalidatePath(`/events/${eventId}`);
}

export async function cancelRsvp(eventId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("event_attendees")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", user.id);
  revalidatePath(`/events/${eventId}`);
}

/** Report an event (target_type = 'event'), feeds /admin/reports?type=event. */
export async function reportEvent(
  eventId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: "event",
    target_id: eventId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
