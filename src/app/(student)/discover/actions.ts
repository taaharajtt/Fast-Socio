"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { DiscoverProfile } from "@/lib/profile/types";

type SwipeResult =
  | { ok: true; matched: boolean }
  | { ok: false; error: string };

/**
 * Record a like/pass. Rate-limited per Phase 1 policy. On a like, the DB trigger
 * creates a match if reciprocal; we report back whether a match now exists so
 * the UI can celebrate.
 */
export async function recordSwipe(
  targetId: string,
  direction: "like" | "pass"
): Promise<SwipeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const limit = direction === "like" ? RATE_LIMITS.like : RATE_LIMITS.pass;
  const allowed = await checkRateLimit(
    direction,
    limit.max,
    limit.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Slow down a little." };

  const { error } = await supabase
    .from("swipes")
    .insert({ swiper_id: user.id, target_id: targetId, direction });
  // Ignore duplicate swipes (already decided); treat as success.
  if (error && error.code !== "23505") {
    return { ok: false, error: error.message };
  }

  let matched = false;
  if (direction === "like") {
    const [lo, hi] = [user.id, targetId].sort();
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("swipes")
    .delete()
    .eq("swiper_id", user.id)
    .eq("target_id", targetId);
  if (error) return { ok: false, error: error.message };

  // If a match had formed from this like, remove it too.
  const [lo, hi] = [user.id, targetId].sort();
  await supabase
    .from("matches")
    .delete()
    .eq("user_low", lo)
    .eq("user_high", hi);

  return { ok: true };
}

/** Send a first-contact message request. Rate-limited. */
export async function sendMessageRequest(
  recipientId: string,
  message: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const text = message.trim();
  if (text.length < 1 || text.length > 500)
    return { ok: false, error: "Message must be 1–500 characters." };

  const allowed = await checkRateLimit(
    "messageRequest",
    RATE_LIMITS.messageRequest.max,
    RATE_LIMITS.messageRequest.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Too many requests for now." };

  const { error } = await supabase
    .from("message_requests")
    .insert({ sender_id: user.id, recipient_id: recipientId, message: text });
  if (error) {
    if (error.code === "23505")
      return { ok: false, error: "You already have a pending request." };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Report a profile for moderator review (writes to the polymorphic reports table). */
export async function reportProfile(
  targetId: string,
  reason: string,
  details?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const allowed = await checkRateLimit(
    "report",
    RATE_LIMITS.report.max,
    RATE_LIMITS.report.windowSeconds
  );
  if (!allowed) return { ok: false, error: "Too many reports for now." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
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
