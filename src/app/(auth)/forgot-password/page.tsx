"use client";

import Link from "next/link";
import { useState } from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { createClient } from "@/lib/supabase/client";

type Step = "email" | "sent";

/**
 * Forgot / set password. Sends a recovery link (resetPasswordForEmail) that
 * routes through /auth/callback?next=/set-password. This is also how the
 * original passwordless cohort (accounts created before email+password login,
 * which have no password) obtain one. The panel is intentionally shown for any
 * submitted address so we never reveal whether an account exists.
 */
export default function ForgotPasswordPage() {
  const supabase = createClient();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter your email.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: `${window.location.origin}/auth/callback?next=/set-password`,
      }
    );
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
      </div>

      {step === "email" ? (
        <>
          <div className="mt-8 text-center">
            <h2 className="text-[28px] font-black leading-[1.15] tracking-tight text-white">
              Reset your password
            </h2>
            <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-relaxed text-fg-muted">
              Enter your email and we&rsquo;ll send you a link to set a new
              password.
            </p>
          </div>

          <form onSubmit={sendReset} className="mt-8 flex flex-col gap-3">
            <GlassInput
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-label="Email"
              placeholder="you@isb.nu.edu.pk"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
            <GlassButton
              type="submit"
              size="lg"
              className="mt-1 h-[52px] w-full rounded-[var(--radius-pill)] text-base font-bold"
              disabled={loading || !email.trim()}
            >
              {loading ? "Sending link…" : "Send reset link"}
            </GlassButton>

            {error && (
              <p role="alert" className="px-1 text-[13px] text-error">
                {error}
              </p>
            )}
          </form>

          <p className="mt-6 text-center text-[14px] text-fg-muted">
            <Link
              href="/login"
              className="font-semibold text-[#a78bfa] hover:underline"
            >
              Back to log in
            </Link>
          </p>
        </>
      ) : (
        <div className="mt-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-3xl">
            ✉️
          </div>
          <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-white">
            Check your email
          </h2>
          <p className="mx-auto mt-2 max-w-[20rem] text-[15px] leading-relaxed text-fg-muted">
            If an account exists for{" "}
            <span className="font-semibold text-white">{email}</span>, we sent a
            link to set a new password. Tap it on this device.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-[13px] font-semibold text-[#a78bfa] hover:underline"
          >
            Back to log in
          </Link>
        </div>
      )}

      <p className="mt-6 text-center text-[11px] text-fg-disabled">
        Terms of Service · Privacy Policy
      </p>
    </main>
  );
}
