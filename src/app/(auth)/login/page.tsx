"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { createClient } from "@/lib/supabase/client";

/**
 * Login — email + password for returning users (accounts that already exist).
 * New users go to /signup (magic-link verification → set a password → profile
 * setup). Users who never set a password (the original magic-link cohort, or a
 * partial signup) use "Forgot password?" to set one.
 *
 * signInWithPassword runs in the browser client, so the session cookies are set
 * directly by supabase-js; a full navigation to /home then lets the server read
 * the fresh session (the student layout routes onward from there).
 */
export default function LoginPage() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Surface auth-link failures. The /auth/callback and /auth/confirm handlers
  // bounce here with ?error=… when a magic / recovery link can't establish a
  // session (e.g. an expired link, or a PKCE link opened on a different browser
  // than the one that requested it). Without this the redirect was silent and a
  // broken "forgot password" link looked like it simply dumped you on login.
  // Read once via a lazy initializer rather than an effect + setState on mount.
  const [error, setError] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("error")
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      setLoading(false);
      // Deliberately generic — never reveal whether the email exists or the
      // account simply has no password yet (those users go via Forgot password).
      setError("Incorrect email or password.");
      return;
    }
    // Full navigation so the server picks up the just-set session cookies.
    window.location.assign("/home");
  }

  return (
    <main className="w-full max-w-sm">
      {/* Header — app icon + name + tagline (UISpec V3 Screen 1) */}
      <div className="flex flex-col items-center">
        <Image
          src="/brand/logo.png"
          alt="Fast Socio"
          width={270}
          height={135}
          priority
        />
        <p className="mt-1 text-[13px] text-fg-muted">Your campus, alive.</p>
      </div>

      <div className="mt-8 text-center">
        <h2 className="text-[32px] font-black leading-[1.15] tracking-tight text-white">
          Welcome back
        </h2>
        <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-relaxed text-fg-muted">
          Sign in with your email and password.
        </p>
      </div>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
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

        <div className="-mt-1 text-right">
          <Link
            href="/forgot-password"
            className="text-[13px] font-semibold text-[#a78bfa] hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <GlassButton
          type="submit"
          size="lg"
          className="mt-1 h-[52px] w-full rounded-[var(--radius-pill)] text-base font-bold"
          disabled={loading}
        >
          {loading ? "Signing in…" : "Log in"}
        </GlassButton>

        {error && (
          <p role="alert" className="px-1 text-[13px] text-error">
            {error}
          </p>
        )}
      </form>

      <p className="mt-6 text-center text-[14px] text-fg-muted">
        New to FAST SOCIO?{" "}
        <Link
          href="/signup"
          className="font-semibold text-[#a78bfa] hover:underline"
        >
          Create an account
        </Link>
      </p>

      <p className="mt-6 text-center text-[11px] text-fg-disabled">
        Terms of Service · Privacy Policy
      </p>
    </main>
  );
}
