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
