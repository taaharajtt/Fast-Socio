"use client";

import { useReportWebVitals } from "next/web-vitals";
import { useCallback, useRef } from "react";
import { normalisePath } from "@/lib/vitals-path";

/**
 * Real-user Core Web Vitals, reported to our own origin (audit F14).
 *
 * WHY THIS EXISTS
 * The app previously mounted @vercel/speed-insights, which on this self-hosted
 * origin fetched /_vercel/speed-insights/script.js, got 307'd into /login by
 * the auth proxy, and downloaded 30 KB of HTML the browser refused to execute.
 * It collected nothing — production had no RUM at all, which is why the perf
 * audit could not report a single field LCP or INP number and had to fall back
 * to synthetic timings from one vantage point.
 *
 * This replaces it with something that actually works and costs almost nothing:
 * `next/web-vitals` is part of Next's own client runtime, so there is no new
 * dependency and no new script request. The beacon is same-origin, so the
 * existing `connect-src 'self'` CSP already permits it.
 *
 * WHY THE FIELD DATA MATTERS MORE THAN A LIGHTHOUSE RUN
 * The audience is on Pakistani mobile networks roughly 6,000 km from the
 * origin. A Lighthouse run from a developer machine measures a different
 * internet than the one students are on. These are the numbers that decide
 * whether the Phase 1–3 work actually helped.
 *
 * PRIVACY — this is the constraint the whole design is built around:
 *
 *   - Sampled, so this is a measurement of the app, not of any individual.
 *   - NO user id, session id, or device id is attached. Nothing here can be
 *     joined back to a person, deliberately: there is no field to join on.
 *   - The path is normalised before it leaves the browser. /profile/<uuid> is
 *     sent as /profile/[id], /chat/<uuid> as /chat/[id]. Raw dynamic segments
 *     in this app ARE user identifiers, so sending them would turn a metrics
 *     beacon into a record of who looked at whom.
 *   - `sendBeacon` is fire-and-forget and never blocks navigation or unload.
 */

/** Fraction of page loads that report. Override at build time if needed. */
const SAMPLE_RATE = (() => {
  const raw = process.env.NEXT_PUBLIC_VITALS_SAMPLE_RATE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.1;
})();

/** The metrics worth the bytes. FID is deliberately absent — INP replaced it. */
const REPORTED = new Set(["LCP", "INP", "CLS", "FCP", "TTFB"]);

export function WebVitalsReporter() {
  // Decide once per page load, not per metric — otherwise a sampled session
  // would report a random subset of its own metrics and the distributions
  // would be drawn from different populations.
  //
  // The draw happens INSIDE the callback, on first use, and deliberately NOT
  // during render. Under Cache Components a `Math.random()` call in a Client
  // Component's render path is a prerender error ("used Math.random() inside a
  // Client Component without a Suspense boundary above it") — correctly so,
  // since it makes the prerendered output non-deterministic. This component is
  // mounted directly in the root layout, so it would have broken the static
  // shell of every route in the app. The callback only ever runs in the browser
  // after hydration, where randomness is fine.
  const sampled = useRef<boolean | null>(null);

  // Stable reference: the docs are explicit that a changing callback identity
  // causes metrics to be reported more than once.
  const report = useCallback((metric: { name: string; value: number; rating?: string }) => {
    if (sampled.current === null) sampled.current = Math.random() < SAMPLE_RATE;
    if (!sampled.current) return;
    if (!REPORTED.has(metric.name)) return;
    if (typeof navigator === "undefined" || !navigator.sendBeacon) return;

    const body = JSON.stringify({
      name: metric.name,
      // CLS is unitless and small; everything else is milliseconds. Two decimal
      // places keeps CLS meaningful without shipping float noise.
      value: Math.round(metric.value * 100) / 100,
      rating: metric.rating ?? null,
      path: normalisePath(window.location.pathname),
    });

    try {
      navigator.sendBeacon(
        "/api/vitals",
        new Blob([body], { type: "application/json" })
      );
    } catch {
      // A failed metric is not worth a console error in a student's browser.
    }
  }, []);

  useReportWebVitals(report);

  return null;
}
