/**
 * WhatsApp-style day separators for chat threads.
 *
 * Messages are grouped by LOCAL calendar day, so a thread reads
 * "Today / Yesterday / Monday / 24th August 2026" between runs of bubbles
 * rather than forcing the reader to decode a timestamp on every row.
 *
 * Pure and dependency-free so it can be unit-tested and shared by the DM thread
 * and the community room without either owning the rules.
 */

/** Local-day key (not UTC): two messages either side of midnight must split. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Local Y-M-D, zero-padded so keys compare as strings.
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

/** 1 -> "1st", 22 -> "22nd", 13 -> "13th". */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Whole local days between two instants, by calendar date rather than by ms. */
function daysApart(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/**
 * The separator label for a message's timestamp.
 *
 * Today / Yesterday for the two most recent days, the weekday name inside the
 * last week (how WhatsApp reads), and the full date beyond that. `now` is
 * injectable so the behaviour is testable without freezing the clock.
 */
export function chatDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const delta = daysApart(d, now);
  if (delta === 0) return "Today";
  if (delta === 1) return "Yesterday";
  // Only PAST days get a weekday name; a future timestamp (clock skew) falls
  // through to the explicit date rather than claiming a day that has not come.
  if (delta > 1 && delta < 7) return WEEKDAYS[d.getDay()];
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
