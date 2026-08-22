"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Half of ONLINE_WINDOW_MS (2 min) — a missed beat still reads as online.
 *
 * Was 45s; raised to 60s in the perf pass (audit F13). The write it triggers
 * lands on `profiles`, which is the most-read table in the schema, so the beat
 * rate is a direct write-amplification knob: it costs one row update per user
 * per interval whether or not that user did anything. 60s still leaves a full
 * window's worth of slack — one dropped beat is 120s, exactly the boundary,
 * and the visibilitychange listener below re-beats the moment a phone is
 * unlocked, which is when a stale value would actually be noticed.
 */
const BEAT_MS = 60_000;

/**
 * Don't re-issue a beat more often than this from the client, however many
 * visibilitychange events arrive. Locking and unlocking a phone, or switching
 * apps, fires that event repeatedly and each one used to be a database write.
 *
 * Migration 0154 also guards the write server-side (it is a no-op if
 * last_seen_at is under 45s old), so this is the cheap half of a belt-and-
 * braces pair: the client skips the round trip entirely, and the server refuses
 * to write even if some other caller asks.
 */
const MIN_BEAT_GAP_MS = 45_000;

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
    let lastBeatAt = 0;

    async function beat() {
      if (cancelled || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastBeatAt < MIN_BEAT_GAP_MS) return;
      // Stamp BEFORE awaiting, so a burst of visibilitychange events cannot all
      // pass the check while the first request is still in flight.
      lastBeatAt = now;
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
