"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { GlassButton } from "@/components/ui/glass-button";
import { Field } from "@/components/ui/field";
import { createClient } from "@/lib/supabase/client";
import { recallEmail, rememberEmail } from "@/lib/auth/last-email";

/** Static for the lifetime of the document — nothing to subscribe to. */
const noopSubscribe = () => () => {};

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

  // The email field is prefilled from the last successful sign-in IN THIS
  // STORAGE PARTITION — on an installed iOS app that is its own partition, so
  // it is empty on the very first launch and useful on every one after it (see
  // lib/auth/last-email.ts for why nothing can cross that boundary).
  //
  // Two values rather than one lazy `useState`, because /login is statically
  // prerendered: the server renders an empty field, and seeding state straight
  // from localStorage would make the client's first render disagree — a
  // hydration mismatch on a controlled input. `useSyncExternalStore` uses the
  // server snapshot ("") for the hydration pass and the real value on the very
  // next render, and `typed` takes over the moment the user edits.
  const remembered = useSyncExternalStore(noopSubscribe, recallEmail, () => "");
  const [typed, setTyped] = useState<string | null>(null);
  const email = typed ?? remembered;
  const setEmail = setTyped;

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
    const address = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({
      email: address,
      password,
    });
    if (error) {
      setLoading(false);
      // Deliberately generic — never reveal whether the email exists or the
      // account simply has no password yet (those users go via Forgot password).
      setError("Incorrect email or password.");
      return;
    }
    // Remember the address (never the password) so the next sign-in in this
    // browser — or in this installed app, where the session does not survive an
    // iOS storage partition — is one field instead of two.
    rememberEmail(address);
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
        {/* One word of the tagline carries the brand colour, not the whole
            line. "Your campus," is the setup and stays quiet; "alive." is the
            claim, and it is the smallest possible place to spend purple — a
            single word under the wordmark rather than a tint across the
            sentence. */}
        <p className="type-caption mt-2 text-fg-muted">
          Your campus, <span className="font-semibold text-accent">alive.</span>
        </p>
      </div>

      <div className="mt-8 text-center">
        <h2 className="text-[32px] font-black leading-[1.15] tracking-tight text-white">
          Welcome back
        </h2>
        <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-relaxed text-fg-muted">
          Sign in to your FAST account
        </p>
      </div>

      {/* The installed-app explainer. An installed Home Screen app has its own
          storage, so it never inherits the browser's session — someone who
          signed up in Safari two minutes ago opens the new icon and is asked to
          log in again. Nothing can carry the session across that boundary, so
          the honest fix is to say why rather than let it read as "the app I
          just installed has already forgotten me". Shown only in the installed
          app, and only while signed out (this route redirects when signed in). */}

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        {/* Visible labels, not `aria-label` alone: the placeholder that used to
            carry the field's purpose disappears the moment you start typing,
            which is exactly when a half-filled form is easiest to misread. */}
        <Field
          id="email"
          label="Email"
          icon={Mail}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@isb.nu.edu.pk"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
        <Field
          id="password"
          label="Password"
          icon={Lock}
          type="password"
          revealable
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />

        <div className="-mt-1 text-right">
          <Link
            href="/forgot-password"
            className="pressable focus-ring type-caption inline-block rounded px-1 font-medium text-fg-muted hover:text-fg hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <GlassButton
          type="submit"
          size="lg"
          className="mt-1 w-full text-base font-bold"
          disabled={loading}
        >
          {loading ? "Signing in…" : "Log in"}
          {!loading && <ArrowRight className="h-5 w-5" aria-hidden />}
        </GlassButton>

        {error && (
          <p role="alert" className="px-1 text-[13px] text-error">
            {error}
          </p>
        )}
      </form>

      {/* Two lines: the question is quiet context and the action is the thing
          you are meant to see. Purple, deliberately NOT white — that would put
          it in competition with "Log in" directly above. The hierarchy on this
          screen runs wordmark (brand) → "alive." (brand accent) → Log in
          (highest-contrast primary) → Create an account (brand secondary), so
          the two actions are told apart by colour rather than by size. */}
      <div className="mt-8 text-center">
        <p className="type-callout text-fg-muted">New to FAST SOCIO?</p>
        <Link
          href="/signup"
          className="pressable focus-ring type-headline mt-1 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-accent hover:underline"
        >
          Create an account
          <ArrowRight className="h-[18px] w-[18px]" aria-hidden />
        </Link>
      </div>

      <p className="mt-6 text-center text-[11px] text-fg-disabled">
        Terms of Service &nbsp;•&nbsp; Privacy Policy
      </p>
    </main>
  );
}

