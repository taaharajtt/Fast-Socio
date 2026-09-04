"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import {
  ALL_DEGREES,
  BIO_MAX,
  DEPARTMENTS,
  getDegreesForSchool,
  INTERESTS,
  MIN_INTERESTS,
  SELECTABLE_GENDERS,
} from "@/lib/profile/constants";
import { isAppStorageUrl } from "@/lib/url-safety";

/**
 * Onboarding draft. Every field is optional so a partial autosave can persist
 * whatever the user has entered so far; the required-field check happens only
 * in saveProfile().
 */
export type OnboardingDraft = {
  fullName?: string;
  avatarUrl?: string | null;
  department?: string;
  degree?: string | null;
  gender?: string | null;
  interests?: string[];
  bio?: string;
};

export type SaveProfileResult = { error: string } | undefined;

const GENDER_VALUES = SELECTABLE_GENDERS.map((g) => g.value) as string[];

/** Keep only members of `allowed`, de-duplicated. */
function sanitizeTags(
  values: string[] | undefined,
  allowed: readonly string[]
): string[] {
  if (!values) return [];
  const set = new Set(allowed);
  return [...new Set(values.filter((v) => set.has(v)))];
}

/**
 * Build the `profiles` patch shared by autosave and finalize. Only defined keys
 * land.
 */
function toProfilePatch(d: OnboardingDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (d.fullName !== undefined) patch.full_name = d.fullName.trim() || null;
  if (d.department !== undefined && DEPARTMENTS.includes(d.department as never))
    patch.department = d.department;
  if (d.degree !== undefined)
    patch.degree = d.degree && ALL_DEGREES.includes(d.degree as never) ? d.degree : null;
  if (d.gender !== undefined)
    patch.gender = d.gender && GENDER_VALUES.includes(d.gender) ? d.gender : null;
  if (d.interests !== undefined)
    patch.interests = sanitizeTags(d.interests, INTERESTS);
  if (d.bio !== undefined) patch.bio = d.bio.slice(0, BIO_MAX).trim() || null;
  return patch;
}

/**
 * Autosave a single wizard step. Persists whatever the user has entered plus
 * the step index so onboarding can resume after an interruption. Never marks
 * onboarding complete and never blocks on validation — bad values are simply
 * dropped by the sanitizers.
 */
export async function saveOnboardingStep(
  draft: OnboardingDraft,
  step: number
): Promise<SaveProfileResult> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { error: "You are not signed in." };

  if (draft.avatarUrl && !isAppStorageUrl(draft.avatarUrl))
    return { error: "Invalid avatar image." };

  const patch = toProfilePatch(draft);
  if (draft.avatarUrl !== undefined) patch.avatar_url = draft.avatarUrl;
  patch.onboarding_step = Math.max(0, Math.min(step, 20));

  // Upsert, not update: a user whose profiles row is missing (handle_new_user
  // never landed one — see mig 0075) would otherwise UPDATE zero rows, "succeed"
  // silently, and bounce back to /onboarding forever. Insert self-heals it.
  // RLS ("users can insert their own profile", with_check id = auth.uid()) plus
  // the explicit id keep this scoped to the caller's own row.
  const { error } = await supabase
    .from("profiles")
    .upsert({ ...patch, id: userId }, { onConflict: "id" });
  if (error) return { error: error.message };
  return undefined;
}

/**
 * Finalize onboarding. A FAST SOCIO account must carry a real photo and name, a
 * school + degree, a gender, and at least MIN_INTERESTS interests; only the bio
 * is optional. RLS + the explicit id guarantee the user only writes their own
 * row.
 */
export async function saveProfile(
  draft: OnboardingDraft
): Promise<SaveProfileResult> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { error: "You are not signed in." };

  if (!draft.avatarUrl) return { error: "Please add a profile photo." };
  if (!isAppStorageUrl(draft.avatarUrl))
    return { error: "Invalid avatar image." };
  const fullName = (draft.fullName ?? "").trim();
  if (fullName.length < 2) return { error: "Please enter your name." };
  if (!draft.department || !DEPARTMENTS.includes(draft.department as never))
    return { error: "Please choose your school." };
  if (!draft.degree || !getDegreesForSchool(draft.department).includes(draft.degree))
    return { error: "Please choose your degree." };
  if (!draft.gender || !GENDER_VALUES.includes(draft.gender))
    return { error: "Please select your gender." };
  // Semester is not collected — it's derived from the roll number on read
  // (see lib/profile/semester.ts).
  const interests = sanitizeTags(draft.interests, INTERESTS);
  if (interests.length < MIN_INTERESTS)
    return { error: `Pick at least ${MIN_INTERESTS} interests.` };
  if ((draft.bio ?? "").length > BIO_MAX)
    return { error: `Bio must be ${BIO_MAX} characters or fewer.` };

  const patch = toProfilePatch(draft);
  patch.avatar_url = draft.avatarUrl;
  patch.onboarding_completed = true;

  // Upsert for the same reason as saveOnboardingStep: without a profiles row an
  // UPDATE matches nothing, so onboarding_completed never sticks and the user
  // is redirected back to /onboarding on every visit.
  const { error } = await supabase
    .from("profiles")
    .upsert({ ...patch, id: userId }, { onConflict: "id" });
  if (error) return { error: error.message };

  redirect("/home");
}
