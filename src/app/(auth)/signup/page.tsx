"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { createClient } from "@/lib/supabase/client";
import { isValidFastEmail } from "@/lib/auth/email";
import { rememberEmail } from "@/lib/auth/last-email";

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
    // Remember the address (never anything else) so a later sign-in in this
    // browser starts with the field filled — see lib/auth/last-email.ts.
    rememberEmail(email.trim().toLowerCase());
    setStep("sent");
  }

  return (
    <main className="w-full max-w-sm">
      {/* Header — app icon + name + tagline (UISpec V3 Screen 1) */}
      <div className="flex flex-col items-center">
        <Image src="/brand/logo.png" alt="Fast Socio" width={270} height={135} />
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
            <span className="font-semibold text-white">{email}</span>. Tap it to
            set your password and finish setting up.
          </p>
          {/* The old copy said "tap it on this device", which was both
              unnecessarily restrictive and pointed the wrong way for the users
              who need the most help.

              It is safe to open the link anywhere: verification uses Supabase's
              default confirmation URL, which completes the IMPLICIT flow and
              returns the session in the URL hash — there is no PKCE verifier
              pinned to the browser that requested it (see the long note in
              src/app/auth/callback/page.tsx). So the link signs the user in
              wherever it lands.

              And where it lands matters enormously. Most arrivals come from an
              Instagram link, which opens in Instagram's own webview: a browser
              that cannot install the app, cannot receive notifications, and
              keeps its cookies where no real browser can see them. Opening the
              email in Chrome or Safari is the moment that whole problem solves
              itself — so this is the moment to say so. */}
          <p className="mx-auto mt-3 max-w-[20rem] text-[13px] leading-relaxed text-fg-muted">
            Open it in <span className="font-semibold text-fg">Chrome</span> or{" "}
            <span className="font-semibold text-fg">Safari</span> — not inside
            Instagram. Any device works.
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
