"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  BIO_MAX,
  MAX_INTERESTS,
  MIN_INTERESTS,
} from "@/lib/profile/constants";
import { isAppStorageUrl } from "@/lib/url-safety";

export type UpdateProfileResult = { error: string } | { ok: true };

/**
 * Update the caller's own profile from the in-app Edit screen (CR-002).
 * Mirrors the onboarding validation but leaves onboarding_completed untouched.
 * RLS restricts writes to the owner; we additionally scope to auth.uid().
 */
export async function updateProfile(input: {
  fullName: string;
  department: string;
  gender: string | null;
  interests: string[];
  bio: string;
  avatarUrl: string | null;
  coverUrl: string | null;
}): Promise<UpdateProfileResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are not signed in." };

  const fullName = input.fullName.trim();
  if (fullName.length < 2) return { error: "Please enter your name." };
  if (!input.department) return { error: "Please choose your department." };
  // Semester is derived from the roll number on read, never written here.
  if (
    input.interests.length < MIN_INTERESTS ||
    input.interests.length > MAX_INTERESTS
  )
    return { error: `Pick ${MIN_INTERESTS}–${MAX_INTERESTS} interests.` };
  if (input.bio.length > BIO_MAX)
    return { error: `Bio must be ${BIO_MAX} characters or fewer.` };
  // avatarUrl/coverUrl are client-supplied — only accept media we host (P2-04).
  if (input.avatarUrl && !isAppStorageUrl(input.avatarUrl))
    return { error: "Invalid avatar image." };
  if (input.coverUrl && !isAppStorageUrl(input.coverUrl))
    return { error: "Invalid cover image." };

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      department: input.department,
      gender: input.gender,
      interests: input.interests,
      bio: input.bio.trim() || null,
      avatar_url: input.avatarUrl,
      cover_url: input.coverUrl,
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/profile");
  return { ok: true };
}
