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
