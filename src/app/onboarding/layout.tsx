import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Onboarding shell. No dock — this is a focused, single-task flow. If the user
 * has already completed onboarding, send them into the app.
 */
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", user.id)
    .single();

  if (profile?.onboarding_completed) redirect("/home");

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(40rem 30rem at 15% -10%, rgba(124,92,255,0.22), transparent), radial-gradient(35rem 25rem at 95% 5%, rgba(0,212,255,0.16), transparent)",
        }}
      />
      {children}
    </div>
  );
}
