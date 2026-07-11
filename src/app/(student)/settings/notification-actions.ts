"use server";

import { createClient } from "@/lib/supabase/server";

const ALLOWED = [
  "matches",
  "messages",
  "likes",
  "events",
  "communities",
  "system",
] as const;

/** Toggle a single notification preference for the current user. */
export async function setNotificationPref(
  key: string,
  value: boolean
): Promise<{ error: string } | void> {
  if (!ALLOWED.includes(key as (typeof ALLOWED)[number]))
    return { error: "Unknown preference." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("notification_preferences")
    .update({ [key]: value })
    .eq("user_id", user.id);
  if (error) return { error: error.message };
}

/**
 * Set the quiet-hours window (Refactor Phase 7). During the window, in-app
 * notifications still record but push delivery is suppressed. Hours are 0–23 in
 * Pakistan time and may wrap midnight (e.g. 22 → 7).
 */
export async function setQuietHours(input: {
  enabled: boolean;
  start: number;
  end: number;
}): Promise<{ error: string } | void> {
  const start = Math.trunc(input.start);
  const end = Math.trunc(input.end);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start > 23 ||
    end < 0 ||
    end > 23
  )
    return { error: "Invalid quiet-hours window." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("notification_preferences")
    .update({
      quiet_hours_enabled: input.enabled,
      quiet_start: start,
      quiet_end: end,
    })
    .eq("user_id", user.id);
  if (error) return { error: error.message };
}
