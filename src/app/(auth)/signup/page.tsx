"use client";

import Link from "next/link";
import { useState } from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { createClient } from "@/lib/supabase/client";
import { isValidFastEmail } from "@/lib/auth/email";

type Step = "email" | "sent";

/**
 * Signup — new users verify ownership of their FAST email via a magic link
 * (signInWithOtp with shouldCreateUser), then land on /set-password to create a
 * password, then the profile-setup wizard. The link routes through
 * /auth/callback?next=/set-password. The @isb.nu.edu.pk restriction is enforced
 * here (UX) and by the DB signup trigger (authoritative).
 */
export default function SignupPage() {
  const supabase = createClient();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailInvalid = email.length > 0 && !isValidFastEmail(email);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidFastEmail(email)) {
      setError("Use your FAST Islamabad university email.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/set-password`,
      },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("sent");
  }

  return (
    <main className="w-full max-w-sm">
      {/* Header — app icon + name + tagline (UISpec V3 Screen 1) */}
      <div className="flex flex-col items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[18px] gradient-brand text-[28px] shadow-[0_12px_32px_rgba(124,58,237,0.5)]">
          ⚡
        </div>
        <h1 className="mt-3 text-lg font-bold tracking-tight text-white">
          FAST SOCIO
        </h1>
        <p className="mt-1 text-[13px] text-fg-muted">Your campus, alive.</p>
      </div>

      {step === "email" ? (
        <>
          <div className="mt-8 text-center">
            <h2 className="text-[32px] font-black leading-[1.15] tracking-tight text-white">
              Create your account
            </h2>
            <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-relaxed text-fg-muted">
              Enter your FAST University email — we&rsquo;ll send you a secure
              link to verify it.
            </p>
          </div>

          <form onSubmit={sendLink} className="mt-8 flex flex-col gap-3">
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
                Only FAST Islamabad email addresses are allowed (@isb.nu.edu.pk,
                or i221000@nu.edu.pk for pre-2023 batches).
              </p>
            )}

            <GlassButton
              type="submit"
              size="lg"
              className="mt-1 h-[52px] w-full rounded-[var(--radius-pill)] text-base font-bold"
              disabled={loading || !isValidFastEmail(email)}
            >
              {loading ? "Sending link…" : "Continue"}
            </GlassButton>

            {error && (
              <p role="alert" className="px-1 text-[13px] text-error">
                {error}
              </p>
            )}
          </form>

          <p className="mt-3 text-center text-[11px] text-fg-disabled">
            • Only{" "}
            <span className="font-medium text-fg-muted">@isb.nu.edu.pk</span>{" "}
            addresses are accepted (pre-2023 batches: your{" "}
            <span className="font-medium text-fg-muted">@nu.edu.pk</span> email)
          </p>

          <p className="mt-6 text-center text-[14px] text-fg-muted">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-[#a78bfa] hover:underline"
            >
              Log in
            </Link>
          </p>
        </>
      ) : (
        // The link lands on /auth/callback → /set-password → profile setup.
        <div className="mt-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-3xl">
            ✉️
          </div>
          <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-white">
            Check your email
          </h2>
          <p className="mx-auto mt-2 max-w-[20rem] text-[15px] leading-relaxed text-fg-muted">
            We sent a verification link to{" "}
            <span className="font-semibold text-white">{email}</span>. Tap it on
            this device to set your password and finish setting up.
          </p>
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setError(null);
            }}
            className="mt-6 text-[13px] font-semibold text-[#a78bfa] hover:underline"
          >
            Use a different email
          </button>
        </div>
      )}

      <p className="mt-6 text-center text-[11px] text-fg-disabled">
        Terms of Service · Privacy Policy
      </p>
    </main>
  );
}
