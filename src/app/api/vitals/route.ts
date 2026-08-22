import { NextResponse } from "next/server";
import { normalisePath } from "@/lib/vitals-path";

/**
 * Core Web Vitals sink (audit F14). Receives sampled `sendBeacon` reports from
 * <WebVitalsReporter/> and writes ONE line per metric to stdout.
 *
 * WHY STDOUT AND NOT A TABLE
 * On the VPS this lands in `docker compose logs`, which already has json-file
 * rotation configured (max-size 10m, max-file 5 — see docker-compose.yml), so
 * it is bounded and needs no schema, no migration, no RLS policy, and no
 * cleanup job. Writing metrics to Postgres would add write load to the database
 * this instrumentation exists to protect, which is the wrong trade for data
 * whose entire purpose is to be aggregated and then discarded.
 *
 *   docker compose logs app | grep '\[vitals\]'
 *
 * If this ever needs to be queryable, ship the log lines somewhere rather than
 * pointing this route at the database.
 *
 * WHY IT IS PUBLIC
 * The route is listed in the proxy's public paths on purpose. The login screen
 * is the app's worst-performing page and the first thing every new student
 * sees; gating the beacon behind a session would blind us to exactly the load
 * that matters most. It accepts no user identity and stores none, so there is
 * nothing here to protect with a session.
 *
 * WHAT IT REFUSES
 * Everything is validated and clamped before it is logged. This endpoint is
 * unauthenticated, so its input is entirely attacker-controlled: the metric
 * name must be one we recognise, the value must be a finite number in a sane
 * range, and the path is re-normalised SERVER-SIDE rather than trusted. A
 * client is not the right place to enforce the privacy rule — a crafted beacon
 * could otherwise write an arbitrary string, including someone's id, into our
 * logs. Anything that fails returns 204 and is dropped silently: a metrics
 * endpoint should never hand a prober a useful error.
 */

const ALLOWED = new Set(["LCP", "INP", "CLS", "FCP", "TTFB"]);

/** Generous upper bounds — a real metric above these is a broken measurement. */
const MAX_VALUE: Record<string, number> = {
  LCP: 120_000,
  INP: 120_000,
  FCP: 120_000,
  TTFB: 120_000,
  CLS: 100,
};

const NO_CONTENT = new NextResponse(null, {
  status: 204,
  headers: { "cache-control": "no-store" },
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NO_CONTENT;
  }

  const { name, value, rating, path } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !ALLOWED.has(name)) return NO_CONTENT;
  if (typeof value !== "number" || !Number.isFinite(value)) return NO_CONTENT;
  if (value < 0 || value > MAX_VALUE[name]) return NO_CONTENT;

  // Re-normalise rather than trust: see the note above on attacker-controlled
  // input. Cap the length too, so a long crafted path cannot flood the log.
  const safePath =
    typeof path === "string" && path.length <= 256
      ? normalisePath(path).slice(0, 128)
      : "unknown";

  const safeRating =
    rating === "good" || rating === "needs-improvement" || rating === "poor"
      ? rating
      : "unrated";

  console.log(
    `[vitals] ${name} ${value} ${safeRating} ${safePath}`
  );

  return NO_CONTENT;
}
