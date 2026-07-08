"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GlassButton, GlassInput } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isValidFastEmail } from "@/lib/auth/email";

/**
 * Login — returning users sign in with email + password (new users go to
 * /signup). Passwordless magic-link login was replaced by password auth; the
 * @isb.nu.edu.pk restriction is still enforced by the DB signup trigger.
 */
export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when Supabase reports the account exists but the email isn't verified.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState(false);

  const emailInvalid = email.length > 0 && !isValidFastEmail(email);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUnconfirmed(false);
    if (!isValidFastEmail(email)) {
      setError("Use your @isb.nu.edu.pk university email.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);
    if (error) {
      // Supabase returns a distinct code when the account exists but the email
      // hasn't been verified — surface a resend affordance instead of a dead end.
      if (/email not confirmed/i.test(error.message)) {
        setUnconfirmed(true);
        setError("Verify your email before signing in.");
      } else {
        setError("Incorrect email or password.");
      }
      return;
    }
    // Middleware sends unfinished profiles to onboarding; everyone else home.
    router.replace("/home");
    router.refresh();
  }

  async function resendVerification() {
    setError(null);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim().toLowerCase(),
    });
    if (error) {
      setError(error.message);
      return;
    }
    setResent(true);
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

      {/* Hero */}
      <div className="mt-8 text-center">
        <h2 className="text-[36px] font-black leading-[1.15] tracking-tight text-white">
          Find Your
          <br />
          Campus Tribe
        </h2>
        <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-relaxed text-fg-muted">
          Sign in with your FAST University email to get started.
        </p>
      </div>

      <form onSubmit={signIn} className="mt-8 flex flex-col gap-3">
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

        {/* Password with inline Show/Hide toggle */}
        <div className="relative">
          <GlassInput
            id="password"
            type={showPw ? "text" : "password"}
            autoComplete="current-password"
            aria-label="Password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            className="pr-16"
          />
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#a78bfa]"
            aria-label={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? "Hide" : "Show"}
          </button>
        </div>

        <div className="flex justify-end px-1">
          <Link
            href="/forgot-password"
            className="text-[13px] text-fg-muted hover:text-white"
          >
            Forgot Password?
          </Link>
        </div>

        <GlassButton
          type="submit"
          size="lg"
          className="mt-1 h-[52px] w-full rounded-[var(--radius-pill)] text-base font-bold"
          disabled={loading || !isValidFastEmail(email) || password.length === 0}
        >
          {loading ? "Signing in…" : "Log In"}
        </GlassButton>

        {error && (
          <p role="alert" className="px-1 text-[13px] text-error">
            {error}
          </p>
        )}

        {unconfirmed &&
          (resent ? (
            <p className="px-1 text-[13px] text-accent">
              Verification email sent — check your inbox.
            </p>
          ) : (
            <button
              type="button"
              onClick={resendVerification}
              className="px-1 text-left text-[13px] font-medium text-accent hover:underline"
            >
              Resend verification email
            </button>
          ))}
      </form>

      <p className="mt-3 text-center text-[11px] text-fg-disabled">
        • Only{" "}
        <span className="font-medium text-fg-muted">@isb.nu.edu.pk</span>{" "}
        addresses are accepted
      </p>

      <p className="mt-5 text-center text-[13px] text-fg-muted">
        New to FAST SOCIO?{" "}
        <Link href="/signup" className="font-bold text-[#a78bfa] hover:underline">
          Create account
        </Link>
      </p>

      <p className="mt-6 text-center text-[11px] text-fg-disabled">
        Terms of Service · Privacy Policy
      </p>
    </main>
  );
}
