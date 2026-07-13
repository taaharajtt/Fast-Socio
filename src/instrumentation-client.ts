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

// Adds navigation breadcrumbs / instruments client-side route transitions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
