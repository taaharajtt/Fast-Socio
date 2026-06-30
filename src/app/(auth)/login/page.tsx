"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GlassButton, GlassCard, GlassInput } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isValidFastEmail } from "@/lib/auth/email";

type Step = "email" | "code";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailInvalid = email.length > 0 && !isValidFastEmail(email);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidFastEmail(email)) {
      setError("Use your @nu.edu.pk university email.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("code");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Session cookies are set; land on the app.
    router.replace("/home");
    router.refresh();
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
          <form onSubmit={sendCode} className="space-y-4">
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
              {loading ? "Sending code…" : "Continue"}
            </GlassButton>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="code" className="text-sm font-medium text-white">
                Enter the 6-digit code
              </label>
              <p className="text-sm text-white/60">Sent to {email}</p>
              <GlassInput
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                disabled={loading}
                className="text-center text-lg tracking-[0.4em]"
              />
            </div>
            <GlassButton
              type="submit"
              size="lg"
              className="w-full"
              disabled={loading || code.length !== 6}
            >
              {loading ? "Verifying…" : "Verify & continue"}
            </GlassButton>
            <GlassButton
              type="button"
              variant="ghost"
              size="md"
              className="w-full"
              disabled={loading}
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              Use a different email
            </GlassButton>
          </form>
        )}

        {error && <p className="text-sm text-error">{error}</p>}
      </GlassCard>

      <p className="px-4 text-center text-xs text-white/50">
        By continuing you agree to the Terms of Service and Privacy Policy.
      </p>
    </main>
  );
}
