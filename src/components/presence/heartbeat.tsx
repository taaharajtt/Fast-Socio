"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/** Matches ONLINE_WINDOW_MS / 2.66 — a missed beat still reads as online. */
const BEAT_MS = 45_000;

/**
 * Stamps `profiles.last_seen_at` while the app is actually being used (UAT-003).
 *
 * Presence used to be a hardcoded green dot, so every user appeared online
 * forever. The heartbeat only fires when the document is visible, so a
 * backgrounded tab or a closed PWA goes stale on its own and the user falls out
 * of the online window without needing any disconnect signal.
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function beat() {
      if (cancelled || document.visibilityState !== "visible") return;
      await supabase.rpc("touch_last_seen");
    }

    beat();
    const interval = setInterval(beat, BEAT_MS);
    // Coming back to the tab should refresh presence immediately rather than
    // waiting out the remainder of the interval.
    document.addEventListener("visibilitychange", beat);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  return null;
}
