/**
 * Normalise a pathname to a ROUTE, so a metrics report can never carry an
 * identifier (audit F14).
 *
 * Shared deliberately by BOTH the browser reporter and the server route, and
 * kept in its own module — neither `"use client"` nor `server-only` — for two
 * reasons:
 *
 *   1. Importing it from the `"use client"` component into the route handler
 *      would hand the handler a client reference rather than this function.
 *   2. The server must re-run it rather than trust the client's output. The
 *      /api/vitals endpoint is unauthenticated, so its input is entirely
 *      attacker-controlled; a crafted beacon could otherwise write an arbitrary
 *      string — including someone's id — straight into our logs.
 *
 * In this app the dynamic segments ARE user identifiers: /profile/<uuid>,
 * /chat/<uuid>, /post/<uuid>. Reporting them raw would turn a performance
 * beacon into a record of who looked at whom, so the rule is mask-by-default —
 * anything identifier-shaped or merely long becomes `[id]`, and only short,
 * recognisable, static segments survive.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Campus roll numbers are usernames (e.g. i232064) and identify a person. */
const ROLL_RE = /^i\d{6}$/i;

export function normalisePath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (UUID_RE.test(segment)) return "[id]";
      if (ROLL_RE.test(segment)) return "[id]";
      // Anything unexpectedly long is opaque by assumption, so mask it. No
      // real route segment in this app is over 24 characters.
      if (segment.length > 24) return "[id]";
      return segment;
    })
    .join("/");
}
