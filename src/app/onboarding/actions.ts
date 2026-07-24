"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ALL_DEGREES,
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
  degree?: string | null;
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

/**
 * Build the `profiles` patch shared by autosave and finalize. Only defined keys
 * land.
 *
 * The wizard's location + matching-preference fields are NOT here — they live
 * on profile_private (mig 0089) so no other user can read them, and go through
 * toPrivatePatch() below.
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
  if (d.graduationYear !== undefined) patch.graduation_year = d.graduationYear;
  return patch;
}

/**
 * Build the `profile_private` patch — the half of the wizard no other user may
 * read (mig 0089, F16).
 *
 * These used to sit on `profiles`, where a SELECT policy of `using (true)` made
 * them readable by anyone with an account: `GET /rest/v1/profiles?select=*`
 * returned every user's pref_genders, relationship_pref, hometown and
 * hostel_status. On profile_private, RLS scopes reads to the owner.
 *
 * Same sanitizers as before — only the destination table changed.
 */
function toPrivatePatch(d: OnboardingDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (d.hostelStatus !== undefined)
    patch.hostel_status =
      d.hostelStatus && HOSTEL_VALUES.includes(d.hostelStatus)
        ? d.hostelStatus
        : null;
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

  // Upsert, not update: a user whose profiles row is missing (handle_new_user
  // never landed one — see mig 0075) would otherwise UPDATE zero rows, "succeed"
  // silently, and bounce back to /onboarding forever. Insert self-heals it.
  // RLS ("users can insert their own profile", with_check id = auth.uid()) plus
  // the explicit id keep this scoped to the caller's own row.
  const { error } = await supabase
    .from("profiles")
    .upsert({ ...patch, id: user.id }, { onConflict: "id" });
  if (error) return { error: error.message };

  // The private half (mig 0089). Sequential, not parallel: profile_private.id
  // is FK'd to profiles.id, so the profiles row must exist first for a
  // self-healing insert to land.
  const priv = toPrivatePatch(draft);
  if (Object.keys(priv).length > 0) {
    const { error: pErr } = await supabase
      .from("profile_private")
      .upsert({ ...priv, id: user.id }, { onConflict: "id" });
    if (pErr) return { error: pErr.message };
  }
  return undefined;
}

/**
 * Finalize onboarding. Applies the same required-field validation as before
 * (name, department, semester, interests, bio), writes the full identity
 * vector, and marks onboarding complete. RLS + the eq(id) scope guarantee the
 * user only writes their own row.
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
  // Semester is not collected — it's derived from the roll number on read
  // (see lib/profile/semester.ts).
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

  // Upsert for the same reason as saveProfileStep: without a profiles row an
  // UPDATE matches nothing, so onboarding_completed never sticks and the user
  // is redirected back to /onboarding on every visit.
  const { error } = await supabase
    .from("profiles")
    .upsert({ ...patch, id: user.id }, { onConflict: "id" });
  if (error) return { error: error.message };

  // The private half (mig 0089), before the redirect — a throw here would leave
  // onboarding marked complete with the matching preferences dropped.
  const priv = toPrivatePatch(draft);
  if (Object.keys(priv).length > 0) {
    const { error: pErr } = await supabase
      .from("profile_private")
      .upsert({ ...priv, id: user.id }, { onConflict: "id" });
    if (pErr) return { error: pErr.message };
  }

  redirect("/home");
}
