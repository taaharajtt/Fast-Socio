import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

/**
 * Set-password screen. Reached with an active session established by a link:
 *   - signup magic link  → new user sets their first password → profile setup
 *   - recovery link       → existing user resets their password → home
 *
 * Server component so the session + onboarding state are read without a
 * client-side effect. The destination after saving depends on whether the
 * account has finished onboarding: brand-new signups continue to the wizard,
 * everyone else goes home. Without a session the link has expired — we show a
 * recovery path instead of a dead form.
 */
export default async function SetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="w-full max-w-sm text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-error/15 text-3xl">
          ⚠️
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-white">
          Link expired
        </h1>
        <p className="mx-auto mt-2 max-w-[20rem] text-[15px] leading-relaxed text-fg-muted">
          This link is no longer valid. Request a new one and try again.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/forgot-password"
            className="text-[14px] font-semibold text-[#a78bfa] hover:underline"
          >
            Send a new reset link
          </Link>
          <Link
            href="/login"
            className="text-[13px] font-semibold text-fg-muted hover:underline"
          >
            Back to log in
          </Link>
        </div>
      </main>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", user.id)
    .single();

  // New signups continue into profile setup; returning users (password reset)
  // go straight home.
  const redirectTo = profile?.onboarding_completed ? "/home" : "/onboarding";
  const isNewUser = !profile?.onboarding_completed;

  return <SetPasswordForm redirectTo={redirectTo} isNewUser={isNewUser} />;
}
