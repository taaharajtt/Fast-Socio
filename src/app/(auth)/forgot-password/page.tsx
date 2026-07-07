"use client";

import { useState } from "react";
import Link from "next/link";
import { GlassButton, GlassCard, GlassInput, glassButton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isValidFastEmail } from "@/lib/auth/email";

/**
 * Forgot password — sends a Supabase recovery link that lands on /auth/callback
 * (exchanges the code for a session) and forwards to /reset-password to set a new
 * password. This is also how the pre-existing magic-link accounts obtain a
 * password for the first time.
 */
export default function ForgotPasswordPage() {
  const supabase = createClient();

  const [step, setStep] = useState<"form" | "sent">("form");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailInvalid = email.length > 0 && !isValidFastEmail(email);

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidFastEmail(email)) {
      setError("Use your @isb.nu.edu.pk university email.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` }
    );
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Always show success (don't reveal whether an account exists).
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
            <h2 className="text-lg font-bold text-white">Check your email</h2>
            <p className="text-sm text-white/70">
              If an account exists for{" "}
              <span className="font-medium text-white">{email}</span>, we sent a
              link to reset your password.
            </p>
          </div>
          <Link href="/login" className={glassButton({ size: "md" }) + " w-full"}>
            Back to login
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
        </div>
      </div>

      <div className="mb-8 text-center">
        <h2 className="text-[28px] font-extrabold leading-[1.15] tracking-tight text-white">
          Reset your password
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/75">
          Enter your email and we&rsquo;ll send you a reset link.
        </p>
      </div>

      <form onSubmit={sendReset} className="flex flex-col gap-3">
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
          className="mt-1 w-full rounded-[var(--radius-pill)]"
          disabled={loading || !isValidFastEmail(email)}
        >
          {loading ? "Sending link…" : "Send reset link"}
        </GlassButton>

        {error && (
          <p role="alert" className="px-1 text-[13px] text-error">
            {error}
          </p>
        )}
      </form>

      <p className="mt-8 text-center text-sm text-white/70">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-white hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
