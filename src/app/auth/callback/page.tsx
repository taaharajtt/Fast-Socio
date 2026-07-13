"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/url-safety";

/**
 * Client-side auth-link landing page (magic-link signup + password recovery).
 *
 * The free-tier email templates can't be customised, so Supabase sends the
 * default `{{ .ConfirmationURL }}` link. That routes through GoTrue's
 * `/auth/v1/verify` endpoint, which — with no PKCE challenge on the link —
 * completes the *implicit* flow and hands the session back in the URL **hash
 * fragment** (`#access_token=…&refresh_token=…&type=recovery`). A hash is never
 * sent to the server, so the previous server Route Handler here saw only
 * `?next=…`, found no `code`, and bounced everyone to /login — which is exactly
 * why "forgot password" never reached the set-password screen.
 *
 * A Client Component fixes it: the browser Supabase client parses the hash on
 * init (`detectSessionInUrl`), persists the session to cookies, then we do a
 * full navigation to `next` so the server picks up the fresh session. This also
 * transparently handles `?code=` (PKCE) links, since the same init path covers
 * both callback types.
 */
export default function AuthCallbackPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const url = new URL(window.location.href);
    const next = safeNextPath(url.searchParams.get("next"));

    // An outright failure can arrive in the hash (implicit) or the query.
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const errorDescription =
      hashParams.get("error_description") ??
      url.searchParams.get("error_description") ??
      hashParams.get("error") ??
      url.searchParams.get("error");

    let done = false;
    const go = (to: string) => {
      if (done) return;
      done = true;
      window.location.assign(to);
    };

    if (errorDescription) {
      go(`/login?error=${encodeURIComponent(errorDescription)}`);
      return;
    }

    // getSession() awaits the client's URL-detection/init, so a valid link has
    // a live session by the time it resolves. onAuthStateChange is a belt-and-
    // braces backup in case detection resolves a beat later.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) go(next);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        go(next);
        return;
      }
      // No session and no explicit error → the link is invalid or already used.
      window.setTimeout(() => {
        if (!done) {
          setFailed(true);
          go(
            `/login?error=${encodeURIComponent(
              "This link is invalid or has expired. Request a new one."
            )}`
          );
        }
      }, 3000);
    });

    return () => {
      done = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <main className="flex w-full max-w-sm flex-col items-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[18px] gradient-brand text-[28px] shadow-[0_12px_32px_rgba(124,58,237,0.5)]">
        ⚡
      </div>
      <p className="mt-6 text-[15px] text-fg-muted">
        {failed ? "Redirecting…" : "Signing you in…"}
      </p>
    </main>
  );
}
