"use client";

import { useState } from "react";
import { GlassButton } from "@/components/ui/glass-button";
import { GlassInput } from "@/components/ui/glass-input";
import { createClient } from "@/lib/supabase/client";
import { passwordError, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";

/**
 * Client form for /set-password. Sets the password on the current session
 * (updateUser) then navigates on — a full navigation so the server sees the
 * updated auth state. `isNewUser` only tweaks the copy; `redirectTo` (decided
 * server-side from onboarding state) is where we go after saving.
 */
export function SetPasswordForm({
  redirectTo,
  isNewUser,
}: {
  redirectTo: string;
  isNewUser: boolean;
}) {
  const supabase = createClient();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    // Full navigation so the server picks up the updated session.
    window.location.assign(redirectTo);
  }

  return (
    <main className="w-full max-w-sm">
      <div className="flex flex-col items-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[18px] gradient-brand text-[28px] shadow-[0_12px_32px_rgba(124,58,237,0.5)]">
          ⚡
        </div>
        <h1 className="mt-3 text-lg font-bold tracking-tight text-white">
          FAST SOCIO
        </h1>
      </div>

      <div className="mt-8 text-center">
        <h2 className="text-[28px] font-black leading-[1.15] tracking-tight text-white">
          {isNewUser ? "Create a password" : "Set a new password"}
        </h2>
        <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-relaxed text-fg-muted">
          {isNewUser
            ? "You'll use this with your email to log in next time."
            : "Choose a new password for your account."}
        </p>
      </div>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
        <GlassInput
          id="password"
          type="password"
          autoComplete="new-password"
          aria-label="New password"
          placeholder={`New password (${PASSWORD_MIN_LENGTH}+ chars, mixed case & a number)`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
        <GlassInput
          id="confirm"
          type="password"
          autoComplete="new-password"
          aria-label="Confirm password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={loading}
        />

        <GlassButton
          type="submit"
          size="lg"
          className="mt-1 h-[52px] w-full rounded-[var(--radius-pill)] text-base font-bold"
          disabled={loading || !password || !confirm}
        >
          {loading
            ? "Saving…"
            : isNewUser
              ? "Save & continue"
              : "Save password"}
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
