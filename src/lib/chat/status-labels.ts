/**
 * Instagram-style status labels for DMs.
 *
 * Three separate ideas that a chat UI keeps conflating, kept apart here so each
 * can be tested and so neither can leak the other's data:
 *
 *  - DELIVERY STATUS of MY last outgoing message — "Sent 5m ago" / "Seen 2m ago".
 *  - ACTIVITY of the OTHER person — "Active now" / "Active 25m ago". This is
 *    app-wide presence, NOT evidence that they read anything. Someone can be
 *    active all day and never open the thread, so `Seen` must never be inferred
 *    from activity, and activity must never be inferred from a read receipt.
 *  - EXACT TIME of one message, revealed on demand rather than printed under
 *    every bubble.
 *
 * Every function takes `now` so behaviour is testable without freezing the
 * clock, and every rendered time goes through `toLocale*`, i.e. the VIEWER's
 * timezone — never the sender's and never UTC.
 */

/** The bits of a message this module needs; the row has many more columns. */
export type OutgoingStatus = {
  createdAt: string;
  /** When the recipient read it. Null = not read (or hidden by privacy). */
  readAt: string | null;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "Active now" tolerance, matching the presence heartbeat's own window. */
export const ACTIVE_NOW_MS = 2 * MINUTE;

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Whole LOCAL calendar days between two instants (not a ms division). */
function daysApart(then: Date, now: Date): number {
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * The relative stamp a status label ends with: "just now", "5m ago", "3h ago",
 * "yesterday", "Aug 28", "Aug 28, 2026".
 *
 * Deliberately NOT the compact `timeAgo` used on inbox rows: a status line
 * reads as a sentence ("Sent 5m ago"), so it needs the "ago" and it needs
 * "just now" rather than a bare "now".
 */
export function relativeStamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const delta = now.getTime() - then.getTime();
  // A timestamp slightly in the future (clock skew between devices) is "just
  // now" rather than a negative age.
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;

  const days = daysApart(then, now);
  if (days === 0) return `${Math.floor(delta / HOUR)}h ago`;
  if (days === 1) return "yesterday";
  const date = `${SHORT_MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear()
    ? date
    : `${date}, ${then.getFullYear()}`;
}

/**
 * "Active now" / "Active 25m ago" / "Active yesterday", or null when there is
 * nothing to show.
 *
 * Null covers both "we have never seen them" and "they switched activity status
 * off" — the second one arrives here as a null timestamp because the presence
 * table's RLS policy declines to return the row at all. There is deliberately
 * no other way to express "hidden": a caller cannot accidentally render a label
 * for someone who opted out.
 */
export function activityLabel(
  lastActiveAt: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (!lastActiveAt) return null;
  const then = new Date(lastActiveAt);
  if (Number.isNaN(then.getTime())) return null;
  const delta = now.getTime() - then.getTime();
  if (delta < ACTIVE_NOW_MS) return "Active now";

  const days = daysApart(then, now);
  if (days === 0) {
    return delta < HOUR
      ? `Active ${Math.floor(delta / MINUTE)}m ago`
      : `Active ${Math.floor(delta / HOUR)}h ago`;
  }
  if (days === 1) return "Active yesterday";
  // Older than yesterday: hidden rather than dated. A week-old "last active"
  // says nothing useful and reads as surveillance.
  return null;
}

/**
 * The delivery line for MY last outgoing message: "Seen 2m ago" or "Sent 5m ago".
 *
 * `showReadReceipts` is the RECIPIENT's setting. When it is off the sender is
 * told only that the message was sent — `readAt` must not reach the UI at all,
 * which is why this returns the whole string rather than a flag the caller
 * could misuse.
 */
export function deliveryLabel(
  status: OutgoingStatus | null | undefined,
  showReadReceipts: boolean,
  now: Date = new Date()
): string | null {
  if (!status) return null;
  if (status.readAt && showReadReceipts) {
    return `Seen ${relativeStamp(status.readAt, now)}`;
  }
  return `Sent ${relativeStamp(status.createdAt, now)}`;
}

/**
 * The one label an inbox row shows beside its preview.
 *
 * Priority, matching Instagram: what happened to MY last message wins, because
 * it is the thing the viewer is waiting on. With no outgoing message to report
 * on, the other person's activity is shown instead — and when that is hidden or
 * stale, nothing is shown at all.
 */
export function conversationStatusLabel(
  {
    lastOutgoing,
    showReadReceipts,
    lastActiveAt,
  }: {
    lastOutgoing?: OutgoingStatus | null;
    showReadReceipts: boolean;
    lastActiveAt?: string | null;
  },
  now: Date = new Date()
): string | null {
  return (
    deliveryLabel(lastOutgoing, showReadReceipts, now) ??
    activityLabel(lastActiveAt, now)
  );
}

/** The exact local time of one message, revealed on hover/focus/tap. */
export function exactMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = daysApart(d, new Date());
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (days === 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
}
