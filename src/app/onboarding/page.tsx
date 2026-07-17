import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "./wizard";
import type { OnboardingDraft } from "./actions";

/**
 * Onboarding entry (Refactor Phase 2). Server component: loads any partially
 * saved profile so the multi-step wizard can resume where the user left off
 * (onboarding_step + previously entered fields), then hands off to the client
 * wizard. A user who already finished onboarding is bounced to /home.
 */
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Two reads: the private half (location + matching preferences) lives in
  // profile_private, where RLS scopes it to the owner — see mig 0089. Both are
  // own-row, so they run in parallel.
  const [{ data: p }, { data: pv }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "full_name, avatar_url, department, semester, gender, interests, bio, personality, languages, pronouns, graduation_year, onboarding_step, onboarding_completed"
      )
      .eq("id", user.id)
      .single(),
    supabase
      .from("profile_private")
      .select(
        "hostel_status, hometown, relationship_pref, pref_genders, pref_semester_min, pref_semester_max, pref_verified_only"
      )
      .eq("id", user.id)
      // maybeSingle, not single: mig 0089 backfills and triggers a row for every
      // profile, but a missing one should resume the wizard with empty prefs
      // rather than throw.
      .maybeSingle(),
  ]);

  if (p?.onboarding_completed) redirect("/home");

  const initial: OnboardingDraft = {
    fullName: p?.full_name ?? "",
    avatarUrl: p?.avatar_url ?? null,
    department: p?.department ?? "",
    semester: p?.semester ?? null,
    gender: p?.gender ?? null,
    interests: p?.interests ?? [],
    bio: p?.bio ?? "",
    personality: p?.personality ?? [],
    languages: p?.languages ?? [],
    pronouns: p?.pronouns ?? null,
    graduationYear: p?.graduation_year ?? null,
    hostelStatus: pv?.hostel_status ?? null,
    hometown: pv?.hometown ?? null,
    relationshipPref: pv?.relationship_pref ?? null,
    prefGenders: pv?.pref_genders ?? [],
    prefSemesterMin: pv?.pref_semester_min ?? null,
    prefSemesterMax: pv?.pref_semester_max ?? null,
    prefVerifiedOnly: pv?.pref_verified_only ?? false,
  };

  return (
    <OnboardingWizard initial={initial} initialStep={p?.onboarding_step ?? 0} />
  );
}
