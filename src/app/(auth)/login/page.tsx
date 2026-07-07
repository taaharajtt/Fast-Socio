"use client";

import { useState } from "react";
import { GlassButton, GlassCard, GlassInput } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isValidFastEmail } from "@/lib/auth/email";

type Step = "email" | "sent";

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
      setError("Use your @nu.edu.pk university email.");
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
      {/* Logo mark */}
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

      {step === "email" ? (
        <>
          {/* Headline */}
          <div className="mb-10 text-center">
            <h2 className="text-[34px] font-extrabold leading-[1.15] tracking-tight text-white">
              Find Your
              <br />
              Campus Tribe
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              Sign in with your FAST University email
              <br />
              to get started.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={sendLink} className="flex flex-col gap-3">
            <GlassInput
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-label="University email"
              placeholder="you@nu.edu.pk"
              value={email}
              invalid={emailInvalid}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
            {emailInvalid && (
              <p className="px-1 text-[13px] font-medium text-error">
                Only @nu.edu.pk email addresses are allowed.
              </p>
            )}

            <GlassButton
              type="submit"
              size="lg"
              className="mt-1 w-full rounded-[var(--radius-pill)]"
              disabled={loading || !isValidFastEmail(email)}
            >
              {loading ? "Sending link…" : "Continue"}
            </GlassButton>

            {/* Domain hint */}
            <div className="flex items-center gap-2 px-1">
              <span className="h-1 w-1 shrink-0 rounded-full bg-white/40" />
              <p className="text-[11px] text-white/70">
                Only{" "}
                <span className="font-semibold text-white/90">@nu.edu.pk</span>{" "}
                addresses are accepted
              </p>
            </div>

            {error && (
              <p role="alert" className="px-1 text-[13px] text-error">
                {error}
              </p>
            )}
          </form>
        </>
      ) : (
        <GlassCard className="space-y-4 p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-aura/20 text-2xl">
            ✉
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white">Check your email</h2>
            <p className="text-sm text-white/70">
              We sent a sign-in link to{" "}
              <span className="font-medium text-white">{email}</span>. Open it on
              this device to continue.
            </p>
          </div>
          <GlassButton
            type="button"
            variant="ghost"
            size="md"
            className="w-full text-white/80"
            onClick={() => {
              setStep("email");
              setError(null);
            }}
          >
            Use a different email
          </GlassButton>
          {error && <p className="text-sm text-error">{error}</p>}
        </GlassCard>
      )}

      <p className="mt-8 px-4 text-center text-[11px] text-white/55">
        Terms of Service · Privacy Policy
      </p>
    </main>
  );
}
