"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  BIO_MAX,
  DEPARTMENTS,
  GENDERS,
  HOSTEL_STATUS,
  INTERESTS,
  LANGUAGES,
  MAX_INTERESTS,
  MAX_LANGUAGES,
  MAX_PERSONALITY,
  MIN_INTERESTS,
  PERSONALITY_TRAITS,
  RELATIONSHIP_PREFS,
} from "@/lib/profile/constants";
import { isAppStorageUrl } from "@/lib/url-safety";

/**
 * Onboarding draft — the full identity vector the wizard collects. Every field
 * is optional so a partial autosave can persist whatever the user has entered
 * so far; final validation happens only in saveProfile().
 */
export type OnboardingDraft = {
  fullName?: string;
  avatarUrl?: string | null;
  department?: string;
  semester?: number | null;
  gender?: string | null;
  interests?: string[];
  bio?: string;
  // Identity vector (Phase 2)
  personality?: string[];
  languages?: string[];
  pronouns?: string | null;
  hostelStatus?: string | null;
  graduationYear?: number | null;
  hometown?: string | null;
  relationshipPref?: string | null;
  prefGenders?: string[];
  prefSemesterMin?: number | null;
  prefSemesterMax?: number | null;
  prefVerifiedOnly?: boolean;
};

export type SaveProfileResult = { error: string } | undefined;

const GENDER_VALUES = GENDERS.map((g) => g.value) as string[];
const HOSTEL_VALUES = HOSTEL_STATUS.map((h) => h.value) as string[];
const REL_VALUES = RELATIONSHIP_PREFS.map((r) => r.value) as string[];

/** Keep only members of `allowed`, de-duplicated and capped at `max`. */
function sanitizeTags(
  values: string[] | undefined,
  allowed: readonly string[],
  max: number
): string[] {
  if (!values) return [];
  const set = new Set(allowed);
  return [...new Set(values.filter((v) => set.has(v)))].slice(0, max);
}

/** Build the DB patch shared by autosave and finalize. Only defined keys land. */
function toProfilePatch(d: OnboardingDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (d.fullName !== undefined) patch.full_name = d.fullName.trim() || null;
  if (d.department !== undefined && DEPARTMENTS.includes(d.department as never))
    patch.department = d.department;
  if (d.semester !== undefined) patch.semester = d.semester;
  if (d.gender !== undefined)
    patch.gender = d.gender && GENDER_VALUES.includes(d.gender) ? d.gender : null;
  if (d.interests !== undefined)
    patch.interests = sanitizeTags(d.interests, INTERESTS, MAX_INTERESTS);
  if (d.bio !== undefined) patch.bio = d.bio.slice(0, BIO_MAX).trim() || null;
  if (d.personality !== undefined)
    patch.personality = sanitizeTags(
      d.personality,
      PERSONALITY_TRAITS,
      MAX_PERSONALITY
    );
  if (d.languages !== undefined)
    patch.languages = sanitizeTags(d.languages, LANGUAGES, MAX_LANGUAGES);
  if (d.pronouns !== undefined)
    patch.pronouns = d.pronouns?.slice(0, 40).trim() || null;
  if (d.hostelStatus !== undefined)
    patch.hostel_status =
      d.hostelStatus && HOSTEL_VALUES.includes(d.hostelStatus)
        ? d.hostelStatus
        : null;
  if (d.graduationYear !== undefined) patch.graduation_year = d.graduationYear;
  if (d.hometown !== undefined)
    patch.hometown = d.hometown?.slice(0, 60).trim() || null;
  if (d.relationshipPref !== undefined)
    patch.relationship_pref =
      d.relationshipPref && REL_VALUES.includes(d.relationshipPref)
        ? d.relationshipPref
        : null;
  if (d.prefGenders !== undefined)
    patch.pref_genders = sanitizeTags(d.prefGenders, GENDER_VALUES, 4);
  if (d.prefSemesterMin !== undefined)
    patch.pref_semester_min = d.prefSemesterMin;
  if (d.prefSemesterMax !== undefined)
    patch.pref_semester_max = d.prefSemesterMax;
  if (d.prefVerifiedOnly !== undefined)
    patch.pref_verified_only = Boolean(d.prefVerifiedOnly);
  return patch;
}

/**
 * Autosave a single wizard step (Phase 2). Persists whatever the user has
 * entered plus the step index so onboarding can resume after an interruption.
 * Never marks onboarding complete and never blocks on validation — bad values
 * are simply dropped by the sanitizers.
 */
export async function saveOnboardingStep(
  draft: OnboardingDraft,
  step: number
): Promise<SaveProfileResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are not signed in." };

  if (draft.avatarUrl && !isAppStorageUrl(draft.avatarUrl))
    return { error: "Invalid avatar image." };

  const patch = toProfilePatch(draft);
  if (draft.avatarUrl !== undefined) patch.avatar_url = draft.avatarUrl;
  patch.onboarding_step = Math.max(0, Math.min(step, 20));

  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id);
  if (error) return { error: error.message };
  return undefined;
}

/**
 * Finalize onboarding. Applies the same required-field validation as before
 * (name, department, semester, interests, bio), writes the full identity
 * vector, marks onboarding complete, then recomputes completeness and awards
 * the one-time completion Aura bonus via the definer RPC. RLS + the eq(id)
 * scope guarantee the user only writes their own row.
 */
export async function saveProfile(
  draft: OnboardingDraft
): Promise<SaveProfileResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are not signed in." };

  const fullName = (draft.fullName ?? "").trim();
  if (fullName.length < 2) return { error: "Please enter your name." };
  if (!draft.department) return { error: "Please choose your department." };
  if (!draft.semester || draft.semester < 1 || draft.semester > 12)
    return { error: "Please choose your semester." };
  const interests = sanitizeTags(draft.interests, INTERESTS, MAX_INTERESTS);
  if (interests.length < MIN_INTERESTS)
    return { error: `Pick ${MIN_INTERESTS}–${MAX_INTERESTS} interests.` };
  if ((draft.bio ?? "").length > BIO_MAX)
    return { error: `Bio must be ${BIO_MAX} characters or fewer.` };
  if (draft.avatarUrl && !isAppStorageUrl(draft.avatarUrl))
    return { error: "Invalid avatar image." };

  const patch = toProfilePatch(draft);
  patch.avatar_url = draft.avatarUrl ?? null;
  patch.onboarding_completed = true;

  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id);
  if (error) return { error: error.message };

  // Recompute completeness + award the one-time bonus. Non-fatal: a failure
  // here must not strand the user on the wizard after their profile is saved.
  await supabase.rpc("award_completion_bonus").then(
    () => {},
    () => {}
  );

  redirect("/home");
}
