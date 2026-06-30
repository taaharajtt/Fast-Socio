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
    <main className="w-full max-w-sm space-y-8">
      <header className="space-y-2 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-white">
          FAST SOCIO
        </h1>
        <p className="text-base text-white/70">Find your campus tribe</p>
      </header>

      <GlassCard className="space-y-4 p-6">
        {step === "email" ? (
          <form onSubmit={sendLink} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium text-white">
                University email
              </label>
              <GlassInput
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="k21-1234@nu.edu.pk"
                value={email}
                invalid={emailInvalid}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
              {emailInvalid && (
                <p className="text-sm text-error">
                  Use your @nu.edu.pk university email.
                </p>
              )}
            </div>
            <GlassButton
              type="submit"
              size="lg"
              className="w-full"
              disabled={loading || !isValidFastEmail(email)}
            >
              {loading ? "Sending link…" : "Continue"}
            </GlassButton>
          </form>
        ) : (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-aura/20 text-2xl">
              ✉
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">Check your email</h2>
              <p className="text-sm text-white/70">
                We sent a sign-in link to{" "}
                <span className="font-medium text-white">{email}</span>. Open it
                on this device to continue.
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
          </div>
        )}

        {error && <p className="text-sm text-error">{error}</p>}
      </GlassCard>

      <p className="px-4 text-center text-xs text-white/50">
        By continuing you agree to the Terms of Service and Privacy Policy.
      </p>
    </main>
  );
}
