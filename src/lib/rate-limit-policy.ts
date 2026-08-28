// ===========================================================================
// Rate-limit POLICY — the pure half of the limiter.
//
// Split out of `src/lib/rate-limit.ts` (which is "server-only" and therefore
// cannot be imported by a unit test) so the numbers, the result shape and the
// RPC interpretation are all testable without a database. The server module
// re-exports everything here, so every existing
// `import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"` keeps working.
// ===========================================================================

/**
 * The outcome of a limiter check.
 *
 * The old boolean conflated two very different things: "you have used your
 * quota" and "the limiter itself is broken". A user who hit a real quota needs
 * to be told when to come back; a user whose request died on a database error
 * must NOT be told to slow down, because slowing down will not help and the
 * message hides a real outage.
 */
export type RateLimitResult =
  | { status: "allowed" }
  /** Quota genuinely reached. `retryAfterSeconds` is the wait until a slot frees. */
  | { status: "limited"; retryAfterSeconds?: number }
  /** The limiter could not be consulted (RPC/network/DB failure). */
  | { status: "error"; message: string };

/** One limiter bucket: how many actions, over what window. */
export type RateLimitPolicy = {
  /** The `action` key recorded in `rate_limit_events`. */
  action: string;
  max: number;
  windowSeconds: number;
};

/**
 * Common limits, centralized so phases share one policy table.
 *
 * ORDINARY DISCOVER SWIPES ARE NOT IN HERE ANY MORE. `like` (100/hour) and
 * `pass` (300/hour) were removed: a deck of several hundred eligible profiles
 * could not be traversed in one sitting, so the limiter was rejecting the
 * product's core loop rather than abuse. Swipes are now covered only by
 * `DISCOVER_SWIPE_BURST` below. Every OTHER bucket is unchanged — actions that
 * create content, notifications, moderation work or messages for someone else
 * keep their stricter limits.
 */
export const RATE_LIMITS = {
  messageRequest: { max: 20, windowSeconds: 60 * 60 },
  chatSend: { max: 120, windowSeconds: 60 }, // 120 msgs/min
  report: { max: 20, windowSeconds: 24 * 60 * 60 },
  // Post-like toggles: cap the notification/push a target can be made to receive
  // (P5-04). Generous for real use, throttles like/unlike spam loops.
  postLike: { max: 60, windowSeconds: 60 }, // 60 like-toggles/min
} as const;

/**
 * The SOCIO swipe burst guard: **20 completed swipe requests per 10 seconds**,
 * likes and passes sharing one `discoverSwipe` bucket.
 *
 * WHY THESE NUMBERS. 20-in-10s is one swipe every 500ms sustained. Video of
 * real fast swiping tops out around 2-3 cards/second in short flurries and far
 * lower in average use, and the burst is a SLIDING window, so a human flurry
 * drains the bucket and refills it within the same ten seconds. What it does
 * catch is the pathological shape: a duplicate-event storm from a broken drag
 * handler, a client stuck in a retry loop, or a script POSTing the server
 * action directly (Server Functions are reachable by direct POST, not only
 * through the UI — see the Next.js data-security guide, so the client-side
 * dedupe is UX, and THIS is the actual protection).
 *
 * It is deliberately not a quota: hitting it costs the user a few seconds, and
 * no realistic session can exhaust the deck against it.
 */
export const DISCOVER_SWIPE_BURST: RateLimitPolicy = {
  action: "discoverSwipe",
  max: 20,
  windowSeconds: 10,
};

/** Shape of one row from the `check_rate_limit_burst` RPC (migration 0159). */
export type RateLimitRpcRow = {
  allowed: boolean;
  retry_after_seconds: number | null;
};

/**
 * Turn an RPC answer into a result. Pure, so the three-way distinction the
 * whole change rests on can be tested directly.
 *
 * A transport/DB error is `error`, NEVER `limited` — that is the conflation
 * this replaces. Callers that must fail closed decide that themselves (see
 * `isAllowed`), but they can now still report the honest reason.
 */
export function interpretRateLimitRpc(
  data: unknown,
  error: { message?: string } | null
): RateLimitResult {
  if (error) {
    return {
      status: "error",
      message: error.message || "Rate limiter unavailable.",
    };
  }

  // `returns table(...)` comes back as an array of rows; tolerate a bare object.
  const row = (Array.isArray(data) ? data[0] : data) as
    | RateLimitRpcRow
    | undefined
    | null;

  if (!row || typeof row.allowed !== "boolean") {
    return { status: "error", message: "Rate limiter returned no answer." };
  }
  if (row.allowed) return { status: "allowed" };

  const retry =
    typeof row.retry_after_seconds === "number" &&
    Number.isFinite(row.retry_after_seconds) &&
    row.retry_after_seconds > 0
      ? Math.ceil(row.retry_after_seconds)
      : undefined;
  return { status: "limited", retryAfterSeconds: retry };
}

/**
 * Fail-closed collapse to a boolean, preserving the ORIGINAL semantics for the
 * ~25 spam-prone callers that only need allow/deny. An `error` is treated as
 * "not allowed" exactly as before: for reports, message requests and content
 * creation, a broken limiter must not become an open door.
 */
export function isAllowed(result: RateLimitResult): boolean {
  return result.status === "allowed";
}

/** Human-readable text for a genuine quota rejection. */
export function limitedMessage(
  result: Extract<RateLimitResult, { status: "limited" }>,
  fallback: string
): string {
  const s = result.retryAfterSeconds;
  if (!s) return fallback;
  if (s <= 90) return `Try again in ${s} second${s === 1 ? "" : "s"}.`;
  const minutes = Math.ceil(s / 60);
  return `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

// ---------------------------------------------------------------------------
// Reference implementation of the SQL limiter.
//
// `public.check_rate_limit_burst` (migration 0159) is AUTHORITATIVE. This is
// the same sliding window expressed as a pure function so the policy itself —
// "a full deck traverses freely, a duplicate storm does not" — is under test.
// Keep the two in step.
// ---------------------------------------------------------------------------

export type BurstWindow = {
  /** Consume one slot. Serialized by construction, like the SQL's row lock. */
  attempt(nowMs: number): RateLimitResult;
  /** Events currently inside the window. Test/debug view. */
  size(nowMs: number): number;
};

export function createBurstWindow(policy: RateLimitPolicy): BurstWindow {
  const events: number[] = [];
  const windowMs = policy.windowSeconds * 1000;

  function prune(nowMs: number) {
    // Strictly-greater matches the SQL's `created_at > now() - p_window`.
    while (events.length && events[0] <= nowMs - windowMs) events.shift();
  }

  return {
    attempt(nowMs) {
      prune(nowMs);
      if (events.length >= policy.max) {
        const freesAt = events[0] + windowMs;
        return {
          status: "limited",
          retryAfterSeconds: Math.max(1, Math.ceil((freesAt - nowMs) / 1000)),
        };
      }
      events.push(nowMs);
      return { status: "allowed" };
    },
    size(nowMs) {
      prune(nowMs);
      return events.length;
    },
  };
}
