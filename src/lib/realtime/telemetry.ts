"use client";

/**
 * Lifecycle reporting for realtime channels.
 *
 * PRIVACY IS THE WHOLE POINT OF THIS MODULE. Channel names in this app embed
 * ids — `conv:<conversationId>`, `chat-inbox:<userId>` — and event payloads
 * carry message bodies. None of that may reach a log line or an error tracker,
 * so callers pass a static `label` ("chat thread", "chat inbox") and this
 * module refuses to serialise anything else: no ids, no bodies, no session
 * tokens, no Supabase error payloads beyond their status string.
 */

export type RealtimeIssue = {
  /** Static, id-free channel label supplied by the caller. */
  label: string;
  /** SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED, or a synthetic reason. */
  status: string;
};

/**
 * Report a channel problem. Deliberately fire-and-forget and deliberately
 * quiet: a flaky socket is normal on mobile, and a screen full of red console
 * errors during a tunnel trains people to ignore the console.
 *
 * Sentry is imported lazily so this module adds nothing to the initial client
 * bundle for the (overwhelmingly common) case where no channel ever fails.
 */
export function reportRealtimeIssue({ label, status }: RealtimeIssue): void {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[realtime] ${label}: ${status}`);
  }
  if (typeof window === "undefined") return;
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureMessage(`realtime channel ${status}`, {
        level: "warning",
        // Tags only, and only these two. Anything richer risks carrying a
        // conversation id or a message body into an external service.
        tags: { realtime_label: label, realtime_status: status },
      });
    })
    .catch(() => {
      // Telemetry must never be able to break the screen it is reporting on.
    });
}

/**
 * How long a message took to reach the screen, measured from the row's own
 * `created_at` to the moment it is merged into state.
 *
 * THIS IS THE ONLY HONEST MEASURE OF "genuinely realtime". Server-side request
 * latency says nothing about it: a message is delivered over a WebSocket that
 * no access log records, and the audit's 500ms delivery target could not be
 * checked at all before this existed.
 *
 * It is a wall-clock difference between two machines, so it inherits their
 * clock skew. That is tolerable because we care about the DISTRIBUTION and its
 * changes over time, not any single sample — but it is why obviously impossible
 * values are dropped rather than reported. A phone with a badly wrong clock
 * would otherwise poison the percentile in both directions.
 *
 * `source` separates the paths, which matter differently:
 *   "realtime"  — arrived on the socket, the number we are trying to keep low
 *   "catch-up"  — recovered by re-reading after a gap, so the latency is the
 *                 length of the gap and says nothing about socket health
 */
export function reportMessageLatency(
  createdAt: string,
  source: "realtime" | "catch-up"
): void {
  if (typeof window === "undefined") return;
  const sentAt = Date.parse(createdAt);
  if (!Number.isFinite(sentAt)) return;
  const ms = Date.now() - sentAt;
  // Negative means the sender's clock is ahead of ours; beyond ten minutes the
  // sample is measuring a clock, a suspended tab or a very long outage rather
  // than delivery. Neither belongs in a delivery-latency percentile.
  if (ms < 0 || ms > 600_000) return;
  void import("@/lib/telemetry/report")
    .then(({ reportMetric }) =>
      reportMetric("message_delivery", ms, { delivery_source: source })
    )
    .catch(() => {});
}

/**
 * A channel lifecycle transition worth counting: a recovery, a catch-up that
 * actually found something, or the polling fallback engaging.
 *
 * Separate from `reportRealtimeIssue` because these are not problems — they are
 * the recovery machinery working, and their RATE is the health signal. A steady
 * trickle of resubscribes is normal on mobile; a step change in it means the
 * socket has started failing in the field, which is exactly the regression that
 * would otherwise only surface as "chat feels broken sometimes".
 *
 * Still tags only, still no ids: `label` is the same static, id-free string the
 * channel was created with.
 */
export function reportRealtimeEvent(
  label: string,
  event: "recovered" | "catch-up-found" | "poll-engaged",
  count = 1
): void {
  if (typeof window === "undefined") return;
  void import("@/lib/telemetry/report")
    .then(({ reportMetric }) =>
      reportMetric("realtime_event", count, {
        realtime_label: label,
        realtime_event: event,
      })
    )
    .catch(() => {});
}
