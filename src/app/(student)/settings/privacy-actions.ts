"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update({ [key]: value })
    .eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/settings/privacy");
}

/** Set profile visibility ('public' | 'university'). */
export async function setProfileVisibility(
  value: "public" | "university"
): Promise<{ error: string } | void> {
  if (value !== "public" && value !== "university")
    return { error: "Invalid visibility." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .update({ profile_visibility: value })
    .eq("id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/settings/privacy");
}
