// Client-side Sentry initialization. Runs after the document loads but before
// React hydration, so it captures early browser errors.
//
// Privacy: `sendDefaultPii: false` and NO Session Replay — replay would record
// the DOM, which on this app means DMs, profiles, and post content. Error-only
// reporting keeps us clear of capturing student data (launch audit 0.6 / LR-05).
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  debug: false,
});

/**
 * Navigation timing, done entirely OUTSIDE the React tree.
 *
 * WHY NOT A COMPONENT. The first version measured this in <WebVitals/> using
 * `usePathname()`. That component is mounted in the ROOT layout, and
 * `usePathname` is request data — so every route in the app started reporting
 *
 *   Error: Route "...": Uncached data was accessed outside of <Suspense>.
 *
 * and the production build failed. The documented fixes are to wrap it in
 * `<Suspense>` or mark it `use cache`, but the caching guide is explicit that a
 * Suspense boundary in the Root Layout defers the whole app to request time —
 * which would trade every static shell in the product for a telemetry number.
 *
 * So the measurement does not go in the tree at all. `onRouterTransitionStart`
 * is the only hook Next calls at transition start; from there this polls
 * `location.pathname` on animation frames until it changes. No React, no
 * request data, no effect on prerendering.
 *
 * WHAT IT MEASURES. Tap to the new route being on screen — the thing the
 * performance targets are written about, and something no server log can see,
 * because a client-side navigation served from the Client Cache never reaches
 * the server.
 *
 * A transition that never commits is counted SEPARATELY as a stall rather than
 * recorded as a very large duration: a stall and a slow navigation are
 * different problems, and averaging them together hides both.
 */
const STALL_MS = 8_000;

function trackNavigation() {
  if (typeof window === "undefined") return;
  const from = window.location.pathname;
  const startedAt = performance.now();
  let settled = false;

  const finish = (stalled: boolean) => {
    if (settled) return;
    settled = true;
    void import("@/lib/telemetry/report")
      .then(({ reportMetric, countEvent }) => {
        if (stalled) countEvent("navigation_stalled");
        else reportMetric("navigation", performance.now() - startedAt);
      })
      .catch(() => {});
  };

  const tick = () => {
    if (settled) return;
    if (window.location.pathname !== from) {
      // One more frame so the timing includes the paint, not just the commit.
      requestAnimationFrame(() => finish(false));
      return;
    }
    if (performance.now() - startedAt > STALL_MS) {
      finish(true);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Adds navigation breadcrumbs / instruments client-side route transitions.
export const onRouterTransitionStart: typeof Sentry.captureRouterTransitionStart =
  (...args) => {
    try {
      trackNavigation();
    } catch {
      // Never let instrumentation break a navigation.
    }
    return Sentry.captureRouterTransitionStart(...args);
  };
