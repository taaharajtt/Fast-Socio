"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BIO_MAX, MAX_INTERESTS, MIN_INTERESTS } from "@/lib/profile/constants";
import { isAppStorageUrl } from "@/lib/url-safety";

export type SaveProfileResult = { error: string } | undefined;

/**
 * Persist the onboarding answers to the caller's own profile row and mark
 * onboarding complete. Avatar upload happens client-side (Storage); this action
 * receives the resulting public URL. RLS guarantees a user can only write their
 * own row, so we additionally scope the update to auth.uid().
 */
export async function saveProfile(input: {
  fullName: string;
  department: string;
  semester: number;
  gender: string | null;
  interests: string[];
  bio: string;
  avatarUrl: string | null;
}): Promise<SaveProfileResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "You are not signed in." };

  // Server-side validation (never trust the client).
  const fullName = input.fullName.trim();
  if (fullName.length < 2) return { error: "Please enter your name." };
  if (!input.department) return { error: "Please choose your department." };
  if (!input.semester || input.semester < 1 || input.semester > 12)
    return { error: "Please choose your semester." };
  if (
    input.interests.length < MIN_INTERESTS ||
    input.interests.length > MAX_INTERESTS
  )
    return { error: `Pick ${MIN_INTERESTS}–${MAX_INTERESTS} interests.` };
  if (input.bio.length > BIO_MAX)
    return { error: `Bio must be ${BIO_MAX} characters or fewer.` };
  // avatarUrl is client-supplied — only accept an avatar we host (P2-04).
  if (input.avatarUrl && !isAppStorageUrl(input.avatarUrl))
    return { error: "Invalid avatar image." };

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      department: input.department,
      semester: input.semester,
      gender: input.gender,
      interests: input.interests,
      bio: input.bio.trim() || null,
      avatar_url: input.avatarUrl,
      onboarding_completed: true,
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  redirect("/home");
}
