"use client";

import type { createClient } from "@/lib/supabase/client";

type BrowserClient = ReturnType<typeof createClient>;

/**
 * Realtime authorisation for the browser client.
 *
 * Every channel in the app used to open with the same three lines — read the
 * session, hand its access token to `supabase.realtime.setAuth`, subscribe —
 * and then never think about the token again. That is the bug this module
 * exists to fix: Supabase's realtime server drops a socket whose JWT has
 * expired, and `@supabase/ssr` refreshes that JWT roughly hourly in the
 * background. Nothing re-authorised the socket afterwards, so a session left
 * open long enough went silently deaf — no error, no reconnect, just a screen
 * that stopped updating until the user reloaded.
 *
 * `ensureRealtimeAuth` is idempotent and safe to call from every channel setup:
 * the auth listener is wired exactly once per tab (the browser client is a
 * module singleton, see lib/supabase/client.ts), and afterwards every token
 * refresh flows straight through to the realtime socket.
 */

let authListenerWired = false;

export async function ensureRealtimeAuth(supabase: BrowserClient) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) supabase.realtime.setAuth(session.access_token);

  if (!authListenerWired) {
    authListenerWired = true;
    // TOKEN_REFRESHED / SIGNED_IN both carry a new access token. Passing it to
    // the realtime client re-authorises the existing socket in place, so open
    // channels keep delivering instead of dying at the old token's expiry.
    supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession?.access_token) {
        supabase.realtime.setAuth(nextSession.access_token);
      }
    });
  }
}

/** Test seam: forget that the listener was wired (module state otherwise leaks
 *  between test files). Not used in application code. */
export function resetRealtimeAuthForTests() {
  authListenerWired = false;
}
