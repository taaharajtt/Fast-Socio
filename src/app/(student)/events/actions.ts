"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { isAppStorageUrl } from "@/lib/url-safety";

/** Submit a new event for admin approval (status starts pending). */
export async function createEvent(input: {
  title: string;
  description: string;
  category: string;
  location: string;
  startsAt: string; // ISO datetime-local value
  coverUrl?: string | null;
  communityId?: string | null;
  capacity?: number | null;
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
  // Cover is client-supplied — only accept media we host (P2-04).
  if (input.coverUrl && !isAppStorageUrl(input.coverUrl))
    return { error: "Invalid cover image." };
  // Capacity is optional; when set it must be a positive whole number.
  let capacity: number | null = null;
  if (input.capacity != null && `${input.capacity}` !== "") {
    capacity = Math.floor(Number(input.capacity));
    if (!Number.isFinite(capacity) || capacity < 1)
      return { error: "Capacity must be a positive number." };
  }

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
      cover_url: input.coverUrl ?? null,
      starts_at: startsAt.toISOString(),
      capacity,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  redirect(`/events/${data.id}`);
}

/** Outcome of registering; mirrors register_for_event() (mig 0056). */
export type RegisterState =
  | "going"
  | "waitlisted"
  | "already_going"
  | "already_waitlisted"
  | "closed"
  | "ended";

type RsvpResult =
  | { ok: true; state: RegisterState }
  | { ok: false; error: string };

/**
 * Register for an event (Refactor Phase 6). Delegates to register_for_event(),
 * which atomically seats the user or, if the event is at capacity, places them
 * on the waitlist. Idempotent — re-registering returns already_going/waitlisted
 * so Aura is never double-awarded.
 */
export async function rsvp(eventId: string): Promise<RsvpResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase.rpc("register_for_event", {
    p_event: eventId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/events/${eventId}`);
  return { ok: true, state: data as RegisterState };
}

/** Cancel a registration OR leave the waitlist (either state is a no-op miss). */
export async function cancelRsvp(
  eventId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const [seat, wait] = await Promise.all([
    supabase
      .from("event_attendees")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", user.id),
    supabase
      .from("event_waitlist")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", user.id),
  ]);
  if (seat.error) return { ok: false, error: seat.error.message };
  if (wait.error) return { ok: false, error: wait.error.message };
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

/** Post a message to an event's attendee discussion (Refactor Phase 6). */
export async function sendEventMessage(
  eventId: string,
  body: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const text = body.trim();
  if (!text) return { ok: false, error: "Message is empty." };
  if (text.length > 1000)
    return { ok: false, error: "Message is too long." };

  const { error } = await supabase.from("event_messages").insert({
    event_id: eventId,
    sender_id: user.id,
    body: text,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Organizer validates a registration's QR/check-in code (Refactor Phase 6). */
export async function checkInAttendee(
  eventId: string,
  code: string
): Promise<
  | { ok: true; status: string; name: string | null }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: "Enter a check-in code." };

  const { data, error } = await supabase.rpc("check_in_attendee", {
    p_event: eventId,
    p_code: trimmed,
  });
  if (error) return { ok: false, error: error.message };
  const row = (data as { status: string; attendee_name: string | null }[])?.[0];
  if (!row) return { ok: false, error: "No result." };
  return { ok: true, status: row.status, name: row.attendee_name };
}

/** Leave a 1–5 rating + optional comment for an ended event (Phase 6). */
export async function submitEventFeedback(
  eventId: string,
  rating: number,
  comment: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return { ok: false, error: "Pick a rating from 1 to 5." };
  const text = comment.trim().slice(0, 500);

  const { error } = await supabase.from("event_feedback").upsert(
    {
      event_id: eventId,
      user_id: user.id,
      rating,
      comment: text || null,
    },
    { onConflict: "event_id,user_id" }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

/**
 * Delete an event (host or admin only; enforced by the delete_event RPC).
 * Cascades remove attendees, waitlist, discussion, feedback and organizers.
 * Redirects to /events on success; returns { error } if the RPC refuses.
 */
export async function deleteEvent(
  eventId: string
): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.rpc("delete_event", { p_event_id: eventId });
  if (error) return { error: error.message };

  revalidatePath("/events");
  revalidatePath("/profile");
  redirect("/events");
}

export type OrganizerCandidate = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

/**
 * Search students to appoint as co-organizers — matches display name OR roll
 * number (username). Onboarded, non-banned students only. Used by the host's
 * "Manage organizers" panel.
 */
export async function searchStudents(
  query: string
): Promise<OrganizerCandidate[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // Neutralize the characters that would break PostgREST's or()/ilike grammar.
  const safe = q.replace(/[,()*%\\]/g, " ").trim();
  if (!safe) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .eq("onboarding_completed", true)
    .eq("is_banned", false)
    .or(`full_name.ilike.%${safe}%,username.ilike.%${safe}%`)
    .limit(8);
  return (data as OrganizerCandidate[]) ?? [];
}

/** Appoint a co-organizer (host/admin only; enforced by the RPC). */
export async function addOrganizer(
  eventId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("add_event_organizer", {
    p_event: eventId,
    p_user: userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

/** Remove a co-organizer (host/admin only; enforced by the RPC). */
export async function removeOrganizer(
  eventId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("remove_event_organizer", {
    p_event: eventId,
    p_user: userId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
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

  const allowed = await checkRateLimit(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Too many reports for now." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    target_type: "event",
    target_id: eventId,
    reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
