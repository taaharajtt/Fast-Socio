/** Full local date-time for a timestamp, for a hover title (P6-07). */
export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * A user counts as online if their heartbeat landed within this window. The
 * client beats every 45s, so two minutes tolerates one missed beat plus clock
 * skew without flickering someone offline mid-conversation.
 */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function isOnline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

/**
 * Presence caption for a profile: "Active now", "Active 5m ago", or "Offline"
 * for a user who has never been seen (null before the heartbeat shipped).
 */
export function presenceLabel(lastSeenAt: string | null | undefined): string {
  if (!lastSeenAt) return "Offline";
  if (isOnline(lastSeenAt)) return "Active now";
  return `Active ${timeAgo(lastSeenAt)} ago`;
}

/** Compact relative time, e.g. "now", "5m", "3h", "2d", "4w". */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 45) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}
