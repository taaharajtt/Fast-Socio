"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GlassButton, GlassInput } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { passwordError } from "@/lib/auth/password";

/**
 * Set a new password. Reached from a recovery link: /auth/callback exchanges the
 * code for a (recovery) session and forwards here, so updateUser() can set the
 * password. Guards against a missing/expired session so the form doesn't dead-end.
 */
export default function ResetPasswordPage() {
  const supabase = createClient();

  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Confirm a recovery session landed before showing the form.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(Boolean(data.user));
      setReady(true);
    });
  }, [supabase]);

  const pwProblem = password.length > 0 ? passwordError(password) : null;
  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const pwErr = passwordError(password);
    if (pwErr) {
      setError(pwErr);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    // Give a beat to read the success note, then into the app.
    setTimeout(() => {
      window.location.assign("/home");
    }, 1200);
  }

  if (ready && !hasSession) {
    return (
      <main className="w-full max-w-sm text-center">
        <h2 className="text-xl font-bold text-white">Link expired</h2>
        <p className="mt-2 text-sm text-white/75">
          This password reset link is invalid or has expired. Request a new one.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-block font-semibold text-aura hover:underline"
        >
          Get a new reset link
        </Link>
      </main>
    );
  }

  return (
    <main className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h2 className="text-[28px] font-extrabold leading-[1.15] tracking-tight text-white">
          Set a new password
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/75">
          Choose a password for your account.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <GlassInput
          id="password"
          type="password"
          autoComplete="new-password"
          aria-label="New password"
          placeholder="New password (min 8 characters)"
          value={password}
          invalid={Boolean(pwProblem)}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading || done || !hasSession}
        />
        {pwProblem && (
          <p className="px-1 text-[13px] font-medium text-error">{pwProblem}</p>
        )}

        <GlassInput
          id="confirm"
          type="password"
          autoComplete="new-password"
          aria-label="Confirm new password"
          placeholder="Confirm new password"
          value={confirm}
          invalid={mismatch}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={loading || done || !hasSession}
        />
        {mismatch && (
          <p className="px-1 text-[13px] font-medium text-error">
            Passwords don&rsquo;t match.
          </p>
        )}

        <GlassButton
          type="submit"
          size="lg"
          className="mt-1 w-full rounded-[var(--radius-pill)]"
          disabled={
            loading ||
            done ||
            !hasSession ||
            Boolean(passwordError(password)) ||
            password !== confirm
          }
        >
          {done ? "Password updated ✓" : loading ? "Saving…" : "Update password"}
        </GlassButton>

        {error && (
          <p role="alert" className="px-1 text-[13px] text-error">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
