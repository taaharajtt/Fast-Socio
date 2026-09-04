import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import { OnboardingWizard } from "./wizard";
import type { OnboardingDraft } from "./actions";

/**
 * Onboarding entry. Server component: loads any partially saved profile so the
 * wizard can resume where the user left off (onboarding_step + previously
 * entered fields), then hands off to the client wizard. A user who already
 * finished onboarding is bounced to /home.
 */
export default async function OnboardingPage() {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) redirect("/login");

  const { data: p } = await supabase
    .from("profiles")
    .select(
      "full_name, avatar_url, department, degree, gender, interests, bio, onboarding_step, onboarding_completed"
    )
    .eq("id", userId)
    .single();

  if (p?.onboarding_completed) redirect("/home");

  const initial: OnboardingDraft = {
    fullName: p?.full_name ?? "",
    avatarUrl: p?.avatar_url ?? null,
    department: p?.department ?? "",
    degree: p?.degree ?? null,
    gender: p?.gender ?? null,
    interests: p?.interests ?? [],
    bio: p?.bio ?? "",
  };

  return (
    <OnboardingWizard initial={initial} initialStep={p?.onboarding_step ?? 0} />
  );
}
