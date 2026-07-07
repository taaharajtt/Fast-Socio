"use client";

import { useState } from "react";
import Link from "next/link";
import { GlassButton, GlassCard, GlassInput, glassButton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isValidFastEmail } from "@/lib/auth/email";
import { passwordError } from "@/lib/auth/password";

/**
 * Sign up — create an account with email + password, then verify by email. On
 * success Supabase sends a confirmation link (→ /auth/callback); the profile is
 * still collected afterwards by the existing onboarding flow. Domain is enforced
 * client-side here and authoritatively by the DB signup trigger (mig 0021/0031).
 */
export default function SignupPage() {
  const supabase = createClient();

  const [step, setStep] = useState<"form" | "sent">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailInvalid = email.length > 0 && !isValidFastEmail(email);
  const pwProblem = password.length > 0 ? passwordError(password) : null;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidFastEmail(email)) {
      setError("Use your @isb.nu.edu.pk university email.");
      return;
    }
    const pwErr = passwordError(password);
    if (pwErr) {
      setError(pwErr);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);

    if (error) {
      if (/already registered|already exists|already been registered/i.test(error.message)) {
        setError("An account with this email already exists. Log in instead.");
      } else {
        setError(error.message);
      }
      return;
    }
    // If "Confirm email" is disabled in Supabase, signUp returns a live session
    // with no verification. Detect that and route straight in rather than telling
    // the user to check an email that was never sent.
    if (data.session) {
      window.location.assign("/home");
      return;
    }
    setStep("sent");
  }

  if (step === "sent") {
    return (
      <main className="w-full max-w-sm">
        <GlassCard className="space-y-4 p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-aura/20 text-2xl">
            ✉
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white">Verify your email</h2>
            <p className="text-sm text-white/70">
              We sent a verification link to{" "}
              <span className="font-medium text-white">{email}</span>. Open it to
              activate your account, then sign in.
            </p>
          </div>
          <Link
            href="/login"
            className={glassButton({ size: "md" }) + " w-full"}
          >
            Go to login
          </Link>
        </GlassCard>
      </main>
    );
  }

  return (
    <main className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex h-20 w-20 items-center justify-center rounded-[28px] text-4xl gradient-brand shadow-[0_20px_50px_rgba(200,80,192,0.5)]">
          ⚡
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            FAST SOCIO
          </h1>
          <p className="mt-0.5 text-sm text-white/70">Your campus, alive.</p>
        </div>
      </div>

      <div className="mb-8 text-center">
        <h2 className="text-[30px] font-extrabold leading-[1.15] tracking-tight text-white">
          Create your account
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/75">
          Join with your FAST University email.
        </p>
      </div>

      <form onSubmit={signUp} className="flex flex-col gap-3">
        <GlassInput
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          aria-label="University email"
          placeholder="you@isb.nu.edu.pk"
          value={email}
          invalid={emailInvalid}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
        {emailInvalid && (
          <p className="px-1 text-[13px] font-medium text-error">
            Only @isb.nu.edu.pk email addresses are allowed.
          </p>
        )}

        <GlassInput
          id="password"
          type="password"
          autoComplete="new-password"
          aria-label="Password"
          placeholder="Password (min 8 characters)"
          value={password}
          invalid={Boolean(pwProblem)}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
        {pwProblem && (
          <p className="px-1 text-[13px] font-medium text-error">{pwProblem}</p>
        )}

        <GlassInput
          id="confirm"
          type="password"
          autoComplete="new-password"
          aria-label="Confirm password"
          placeholder="Confirm password"
          value={confirm}
          invalid={mismatch}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={loading}
        />
        {mismatch && (
          <p className="px-1 text-[13px] font-medium text-error">
            Passwords don&rsquo;t match.
          </p>
        )}

        <GlassButton
          type="submit"
          size="lg"
          className="mt-1 w-full rounded-[var(--radius-pill)]"
          disabled={
            loading ||
            !isValidFastEmail(email) ||
            Boolean(passwordError(password)) ||
            password !== confirm
          }
        >
          {loading ? "Creating account…" : "Sign up"}
        </GlassButton>

        {error && (
          <p role="alert" className="px-1 text-[13px] text-error">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2 px-1">
          <span className="h-1 w-1 shrink-0 rounded-full bg-white/40" />
          <p className="text-[11px] text-white/70">
            Only{" "}
            <span className="font-semibold text-white/90">@isb.nu.edu.pk</span>{" "}
            addresses are accepted
          </p>
        </div>
      </form>

      <p className="mt-8 text-center text-sm text-white/70">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-white hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
