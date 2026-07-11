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

  const { data: p } = await supabase
    .from("profiles")
    .select(
      "full_name, avatar_url, department, semester, gender, interests, bio, personality, languages, pronouns, hostel_status, graduation_year, hometown, relationship_pref, pref_genders, pref_semester_min, pref_semester_max, pref_verified_only, onboarding_step, onboarding_completed"
    )
    .eq("id", user.id)
    .single();

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
    hostelStatus: p?.hostel_status ?? null,
    graduationYear: p?.graduation_year ?? null,
    hometown: p?.hometown ?? null,
    relationshipPref: p?.relationship_pref ?? null,
    prefGenders: p?.pref_genders ?? [],
    prefSemesterMin: p?.pref_semester_min ?? null,
    prefSemesterMax: p?.pref_semester_max ?? null,
    prefVerifiedOnly: p?.pref_verified_only ?? false,
  };

  return (
    <OnboardingWizard initial={initial} initialStep={p?.onboarding_step ?? 0} />
  );
}
