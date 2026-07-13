// Sentry initialization for the Node.js server runtime (server components,
// route handlers, server actions). Imported from `src/instrumentation.ts`.
//
// Privacy: `sendDefaultPii: false` — we never want student emails, IPs, or
// request bodies (DMs) attached to error events. This is a hard requirement
// from the launch audit (Blocker 0.6 / LR-05). Do not flip it on.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  // No DSN configured (local dev, CI, preview without secrets) → stay disabled
  // so builds and tests never fail on a missing project.
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  // Never attach PII. See file header.
  sendDefaultPii: false,

  // Keep performance tracing light — Vercel Speed Insights already owns Core
  // Web Vitals; this is just enough to catch slow server paths. Tune via env
  // once we see real volume against the Sentry free-tier quota.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),

  // Quieter logs; the SDK's own debug logging is tree-shaken out.
  debug: false,
});
