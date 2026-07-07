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
          Welcome back
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/75">
          Sign in with your FAST University email and password.
        </p>
      </div>

      <form onSubmit={signIn} className="flex flex-col gap-3">
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
          autoComplete="current-password"
          aria-label="Password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />

        <div className="flex justify-end px-1">
          <Link
            href="/forgot-password"
            className="text-[13px] font-medium text-white/70 hover:text-white"
          >
            Forgot password?
          </Link>
        </div>

        <GlassButton
          type="submit"
          size="lg"
          className="mt-1 w-full rounded-[var(--radius-pill)]"
          disabled={loading || !isValidFastEmail(email) || password.length === 0}
        >
          {loading ? "Signing in…" : "Log in"}
        </GlassButton>

        {error && (
          <p role="alert" className="px-1 text-[13px] text-error">
            {error}
          </p>
        )}

        {unconfirmed &&
          (resent ? (
            <p className="px-1 text-[13px] text-aura">
              Verification email sent — check your inbox.
            </p>
          ) : (
            <button
              type="button"
              onClick={resendVerification}
              className="px-1 text-left text-[13px] font-medium text-aura hover:underline"
            >
              Resend verification email
            </button>
          ))}
      </form>

      <p className="mt-8 text-center text-sm text-white/70">
        New here?{" "}
        <Link href="/signup" className="font-semibold text-white hover:underline">
          Sign up
        </Link>
      </p>

      <p className="mt-6 px-4 text-center text-[11px] text-white/55">
        Terms of Service · Privacy Policy
      </p>
    </main>
  );
}
