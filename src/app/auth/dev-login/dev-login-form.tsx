"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Never hardcode credentials in source (P1-01). The dev-login password is read
// from a gitignored env var and only exists in local dev — this page is
// notFound() in production (see page.tsx). Set NEXT_PUBLIC_DEV_LOGIN_PASSWORD in
// .env.local to use it.
const PW = process.env.NEXT_PUBLIC_DEV_LOGIN_PASSWORD ?? "";
const ACCOUNTS = [
  { label: "Sign in as Student", email: "demo-user@nu.edu.pk", dest: "/home" },
  { label: "Sign in as Admin", email: "demo-admin@nu.edu.pk", dest: "/admin" },
];

export function DevLoginForm() {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function signIn(email: string, dest: string) {
    if (!PW) {
      setMsg("Set NEXT_PUBLIC_DEV_LOGIN_PASSWORD in .env.local to use dev login.");
      return;
    }
    setBusy(email);
    setMsg("");
    const { error } = await supabase.auth.signInWithPassword({ email, password: PW });
    if (error) {
      setMsg(error.message);
      setBusy(null);
    } else {
      window.location.assign(dest);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setMsg("Signed out.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <div>
        <h1 className="text-2xl font-bold">
          <span className="gradient-brand-text">FAST SOCIO</span> — dev login
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Local dogfooding shortcut. Pick an account:
        </p>
      </div>

      {ACCOUNTS.map((a) => (
        <button
          key={a.email}
          onClick={() => signIn(a.email, a.dest)}
          disabled={busy !== null}
          className="rounded-[var(--radius-pill)] bg-aura px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === a.email ? "Signing in…" : a.label}
        </button>
      ))}

      <button
        onClick={signOut}
        className="glass rounded-[var(--radius-pill)] px-4 py-2 text-sm text-fg-muted"
      >
        Sign out (switch account)
      </button>

      {msg && <p className="text-sm text-red-400">{msg}</p>}
      <p className="text-xs text-fg-muted/70">
        Student: demo-user@nu.edu.pk · Admin: demo-admin@nu.edu.pk
      </p>
    </main>
  );
}
