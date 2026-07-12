"use client";

import { useState } from "react";
import { GlassButton, GlassInput } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isValidFastEmail } from "@/lib/auth/email";

type Step = "email" | "sent";

/**
 * Login — passwordless magic-link (Supabase signInWithOtp). One email field
 * signs in returning users and creates new ones (shouldCreateUser), so there is
 * no separate signup/password/reset flow. The @isb.nu.edu.pk restriction is
 * enforced client-side here and by the DB signup trigger.
 */
export default function LoginPage() {
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
      setError("Use your @isb.nu.edu.pk university email.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
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
          {/* Hero */}
          <div className="mt-8 text-center">
            <h2 className="text-[36px] font-black leading-[1.15] tracking-tight text-white">
              Find Your
              <br />
              Campus Tribe
            </h2>
            <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-relaxed text-fg-muted">
              Sign in with your FAST University email — we&rsquo;ll send you a
              secure link.
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
                Only @isb.nu.edu.pk email addresses are allowed.
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
            addresses are accepted
          </p>

          <p className="mt-5 text-center text-[13px] text-fg-muted">
            New here? Just enter your email — we&rsquo;ll set you up.
          </p>
        </>
      ) : (
        // Sent confirmation — the link lands on /auth/callback and signs in.
        <div className="mt-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-3xl">
            ✉️
          </div>
          <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-white">
            Check your email
          </h2>
          <p className="mx-auto mt-2 max-w-[20rem] text-[15px] leading-relaxed text-fg-muted">
            We sent a secure sign-in link to{" "}
            <span className="font-semibold text-white">{email}</span>. Tap it on
            this device to continue.
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
