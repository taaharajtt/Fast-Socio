/**
 * Fallback-polling schedule for a realtime channel that is not subscribed.
 *
 * Pure and dependency-free so the policy can be unit-tested without a browser,
 * a socket or fake timers — the hook that consumes it (use-realtime-channel.ts)
 * only turns these numbers into `setTimeout` calls.
 *
 * WHY POLL AT ALL. `postgres_changes` has no replay, and on iOS a backgrounded
 * PWA loses its socket outright. When the channel cannot be established the
 * screen would otherwise sit frozen until the user reloaded. Polling is the
 * floor under that: correctness at a known, bounded cost.
 *
 * WHY IT BACKS OFF. A channel that fails usually keeps failing — a dead
 * network, a blocked WebSocket, a Realtime outage. A flat 5s poll from every
 * connected client during an outage is a self-inflicted thundering herd, so the
 * interval widens and then stays at its ceiling.
 */

/** 5s, then 10s, then 30s for every attempt after that. */
export const POLL_BACKOFF_MS: readonly number[] = [5_000, 10_000, 30_000];

/**
 * Delay before poll number `attempt` (0-based). Attempts past the end of the
 * schedule all use its last entry, so the interval plateaus rather than growing
 * without bound.
 */
export function pollDelayMs(
  attempt: number,
  schedule: readonly number[] = POLL_BACKOFF_MS
): number {
  if (schedule.length === 0) return 0;
  const i = Math.min(Math.max(0, Math.floor(attempt)), schedule.length - 1);
  return schedule[i];
}

export type PollConditions = {
  /** The channel has reported SUBSCRIBED and has not failed since. */
  subscribed: boolean;
  /** `document.visibilityState === "visible"`. */
  visible: boolean;
  /** The consuming component wants a channel at all. */
  enabled: boolean;
};

/**
 * All three conditions must hold. In particular polling stops the instant
 * realtime comes back (`subscribed`), and never runs against a hidden tab —
 * a backgrounded PWA polling on a timer is exactly the battery/data cost that
 * makes people uninstall an app, and there is nobody looking at the result.
 */
export function shouldPoll({ subscribed, visible, enabled }: PollConditions): boolean {
  return enabled && visible && !subscribed;
}
