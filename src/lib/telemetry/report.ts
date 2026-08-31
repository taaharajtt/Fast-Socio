"use client";

/**
 * The one place client-side performance telemetry reaches Sentry.
 *
 * WHY THIS EXISTS. Every number in the 2026-08-31 performance audit had to be
 * gathered by hand — SSH into the VPS, read `cpu.stat`, grep Caddy's JSON log,
 * query `pg_stat_statements`. That is why three plausible-but-wrong causes
 * survived a full round of optimisation: nothing was measuring the layer the
 * time was actually going into, so the theories could not be checked cheaply.
 * This module exists so the NEXT regression is caught by a chart rather than by
 * a student saying the app feels slow.
 *
 * PRIVACY IS A HARD CONSTRAINT, not a preference. This app's URLs embed
 * identifiers — /chat/<conversationId>, /profile/<userId>, /post/<postId> — and
 * `sendDefaultPii` is off and Session Replay is deliberately not enabled
 * (see instrumentation-client.ts) precisely because the DOM here contains DMs.
 * Performance telemetry must not reintroduce what error telemetry was careful
 * to exclude. So:
 *
 *   - routes are reduced to their TEMPLATE (/chat/[id]) before being tagged;
 *   - `sanitizeRoute` strips UUIDs, long hex/opaque ids and numeric segments;
 *   - nothing else from the page is ever attached — no query strings, no bodies,
 *     no signed URLs, no channel names.
 *
 * A unit test asserts that no tag this module produces can contain a UUID.
 *
 * VOLUME IS THE OTHER CONSTRAINT. Web Vitals fire on every navigation, and this
 * is a PWA where people bounce between six tabs. Reporting all of it would cost
 * more than it tells us, so metrics are sampled and the sample rate lives in one
 * constant. Errors are never sampled — those still go through Sentry's own
 * error path untouched.
 */

/** Fraction of sessions that report performance metrics. Errors are unaffected. */
const SAMPLE_RATE = 0.2;

/** Decided ONCE per page load, not per metric, so a sampled session reports a
 *  coherent set of numbers rather than a random scatter across metrics. */
let sampledIn: boolean | null = null;

function inSample(): boolean {
  if (sampledIn === null) sampledIn = Math.random() < SAMPLE_RATE;
  return sampledIn;
}

/** Test seam: force sampling on/off deterministically. */
export function __setSampledForTests(value: boolean | null): void {
  sampledIn = value;
}

const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Reduce a concrete pathname to its route template.
 *
 * `/chat/3f2ca95b-3416-4ef5-8ea1-573b84649229` -> `/chat/[id]`
 *
 * Deliberately conservative: anything that even LOOKS like an identifier is
 * replaced, because the cost of a false positive is a slightly coarser chart
 * and the cost of a false negative is a student's id in a third-party service.
 * Query strings and fragments are dropped entirely — `?_rsc=` and friends carry
 * nothing we want and would shatter the grouping.
 */
export function sanitizeRoute(pathname: string): string {
  const path = pathname.split("?")[0].split("#")[0];
  return (
    path
      .replace(UUID, "[id]")
      .split("/")
      .map((seg) => {
        if (!seg) return seg;
        // Purely numeric, or long enough and opaque enough to be an id.
        if (/^\d+$/.test(seg)) return "[id]";
        if (seg.length >= 16 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg)) {
          return "[id]";
        }
        return seg;
      })
      .join("/") || "/"
  );
}

/** The current route template, or "unknown" outside a browser. */
export function currentRoute(): string {
  if (typeof window === "undefined") return "unknown";
  return sanitizeRoute(window.location.pathname);
}

/**
 * Record a performance measurement.
 *
 * Fire-and-forget, sampled, and lazily imported so a session that reports
 * nothing pays no bundle cost beyond this file. Telemetry must never be able to
 * break the screen it is reporting on, so every failure path is swallowed.
 */
export function reportMetric(
  name: string,
  value: number,
  extraTags: Record<string, string> = {}
): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(value)) return;
  if (!inSample()) return;

  const tags: Record<string, string> = {
    route: currentRoute(),
    ...extraTags,
  };

  void import("@sentry/nextjs")
    .then((Sentry) => {
      // A distribution rather than an event: these are numbers to aggregate,
      // not incidents to triage. `setMeasurement` would attach to the active
      // span, which for a client navigation may already have ended, so the
      // value travels as an explicit metric-shaped message instead.
      Sentry.captureMessage(`perf.${name}`, {
        level: "info",
        tags,
        extra: { value: Math.round(value) },
      });
    })
    .catch(() => {});
}
