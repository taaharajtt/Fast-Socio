import "server-only";

const fmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Karachi", // campus timezone (PKT)
});

/** Human date/time for an event, formatted deterministically on the server. */
export function formatEventDate(iso: string): string {
  return fmt.format(new Date(iso));
}

/** Short date badge, e.g. "31 OCT". */
export function eventBadge(iso: string): { day: string; month: string } {
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      timeZone: "Asia/Karachi",
    }).format(d),
    month: new Intl.DateTimeFormat("en-GB", {
      month: "short",
      timeZone: "Asia/Karachi",
    })
      .format(d)
      .toUpperCase(),
  };
}
