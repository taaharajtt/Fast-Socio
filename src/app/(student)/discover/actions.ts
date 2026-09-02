"use server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth/user";
import {
  checkRateLimitResult,
  limitedMessage,
  DISCOVER_SWIPE_BURST,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import type { DiscoverProfile } from "@/lib/profile/types";

type SwipeResult =
  | { ok: true; matched: boolean }
  | { ok: false; error: string };

/**
 * Record a like/pass. On a like, the DB trigger creates a match if reciprocal;
 * we report back whether a match now exists so the UI can celebrate.
 *
 * RATE LIMITING. The old hourly quotas (100 likes/hour, 300 passes/hour) are
 * GONE. A student with a few hundred eligible candidates could not reach the
 * end of their own deck in one sitting, so the limiter was rejecting the
 * product's core loop rather than abuse — and the rejection arrived as an
 * ambiguous "Slow down a little" that a user could do nothing about.
 *
 * What remains is a burst guard: `DISCOVER_SWIPE_BURST`, 20 completed swipe
 * requests per 10 seconds, with likes and passes sharing ONE bucket. It exists
 * to absorb duplicate-event storms, retry loops and scripted traffic (Server
 * Actions are reachable by direct POST, so the client-side dedupe is UX only —
 * this is the real protection). No realistic session can exhaust a deck
 * against it.
 *
 * The quota is consumed BEFORE the write, so a swipe whose persistence then
 * fails still costs one burst slot. That is deliberate: a client stuck in a
 * failing retry loop is precisely the shape this guard is for, and refunding on
 * failure would make it trivially bypassable. With a 10-second window the cost
 * to a genuine user of a one-off failure is at most a few seconds.
 */
export async function recordSwipe(
  targetId: string,
  direction: "like" | "pass"
): Promise<SwipeResult> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const burst = await checkRateLimitResult(
    DISCOVER_SWIPE_BURST.action,
    DISCOVER_SWIPE_BURST.max,
    DISCOVER_SWIPE_BURST.windowSeconds
  );
  if (burst.status === "limited") {
    return {
      ok: false,
      error: "You’re swiping very quickly. Try again in a few seconds.",
    };
  }
  if (burst.status === "error") {
    // NOT a rate-limit violation: the limiter itself failed. Say so honestly
    // rather than blaming the user's pace. Swipes are low-consequence (a
    // private like/pass row, no content and no notification to anyone else),
    // so this fails CLOSED on persistence but reports the real reason.
    return { ok: false, error: "Couldn’t save that right now — try again." };
  }

  // Upsert, not insert (UAT-002): re-deciding a recycled profile refreshes its
  // swipe timestamp so it drops to the BACK of the resurfaced queue instead of
  // immediately looping back to the front. Composite PK (swiper_id, target_id).
  const { error } = await supabase
    .from("swipes")
    .upsert(
      { swiper_id: userId, target_id: targetId, direction },
      { onConflict: "swiper_id,target_id" }
    );
  if (error) {
    return { ok: false, error: error.message };
  }

  let matched = false;
  if (direction === "like") {
    const [lo, hi] = [userId, targetId].sort();
    const { data } = await supabase
      .from("matches")
      .select("id")
      .eq("user_low", lo)
      .eq("user_high", hi)
      .maybeSingle();
    matched = Boolean(data);
  }

  return { ok: true, matched };
}

/**
 * Undo the most recent like/pass on a target (CR-009, edge case 5). Deletes the
 * swipe row and any match it may have produced, so the profile can reappear.
 */
export async function undoSwipe(
  targetId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("swipes")
    .delete()
    .eq("swiper_id", userId)
    .eq("target_id", targetId);
  if (error) return { ok: false, error: error.message };

  // If a match had formed from this like, remove it too.
  const [lo, hi] = [userId, targetId].sort();
  await supabase
    .from("matches")
    .delete()
    .eq("user_low", lo)
    .eq("user_high", hi);

  return { ok: true };
}

// UAT-01: `sendMessageRequest` used to live here, as a bare INSERT, and was the
// ONLY entry point — which is why the profile page had no way to offer the same
// thing. It now lives in `@/app/(student)/chat/actions` as one canonical action
// over one RPC, called by both the Discover card and the profile.

/** Report a profile for moderator review (writes to the polymorphic reports table). */
export async function reportProfile(
  targetId: string,
  reason: string,
  details?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const userId = await getAuthUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  // Unchanged policy (20/day) — reports create moderation work, so the quota
  // and the fail-closed posture both stay exactly as they were.
  const gate = await checkRateLimitResult(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds
  );
  if (gate.status === "limited") {
    return { ok: false, error: limitedMessage(gate, "Too many reports for now.") };
  }
  if (gate.status === "error") {
    return { ok: false, error: "Couldn’t file that report right now — try again." };
  }

  const { error } = await supabase.from("reports").insert({
    reporter_id: userId,
    target_type: "profile",
    target_id: targetId,
    reason,
    details: details ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Fetch a fresh page of Discover candidates (used when the deck runs low). */
export async function fetchCandidates(
  limit = 20
): Promise<DiscoverProfile[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_discover_candidates", {
    p_limit: limit,
  });
  return (data as DiscoverProfile[]) ?? [];
}
