"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";

// Boolean privacy toggles that map 1:1 to profiles columns (mig 0058). All
// default open; flipping one immediately affects Discover / profile / chat.
const BOOL_PRIVACY = [
  "discoverable",
  "searchable",
  "show_online",
  "read_receipts",
  "show_aura",
  "show_department",
  "show_semester",
  // mig 0182. Only your CURRENT matches could ever open your list; turning this
  // off means nobody but you can. Enforced in get_matches_of(), not here.
  "show_matches",
  // mig 0196. THE ONE INVERTED FLAG on this list: true means "off to others".
  // It is named for what the toggle says so the switch, the column and the RPC
  // all read the same way round. Enforced in send_message_request(), not here —
  // this only records the preference.
  "disable_message_requests",
] as const;

export type PrivacyKey = (typeof BOOL_PRIVACY)[number];

/** Toggle a single boolean privacy setting for the current user. */
export async function setPrivacy(
  key: string,
  value: boolean
): Promise<{ error: string } | void> {
  if (!BOOL_PRIVACY.includes(key as PrivacyKey))
    return { error: "Unknown privacy setting." };

  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update({ [key]: value })
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/settings/privacy");
  // show_matches decides whether the Matches stat links on the viewer's copy of
  // this profile, so the profile surfaces have to be re-rendered too.
  if (key === "show_matches") {
    revalidatePath("/profile");
    revalidatePath(`/profile/${userId}`);
  }
  // Whether "Request to chat" renders is read from this column on every OTHER
  // student's copy of this profile, so the profile route has to be re-rendered
  // for the change to be visible without a hard reload.
  if (key === "disable_message_requests") {
    revalidatePath(`/profile/${userId}`);
  }
}

/** Set profile visibility ('public' | 'university'). */
export async function setProfileVisibility(
  value: "public" | "university"
): Promise<{ error: string } | void> {
  if (value !== "public" && value !== "university")
    return { error: "Invalid visibility." };
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .update({ profile_visibility: value })
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/settings/privacy");
}
