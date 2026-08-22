// Client-side Sentry initialization. Runs after the document loads but before
// React hydration, so it captures early browser errors.
//
// Privacy: `sendDefaultPii: false` and NO Session Replay — replay would record
// the DOM, which on this app means DMs, profiles, and post content. Error-only
// reporting keeps us clear of capturing student data (launch audit 0.6 / LR-05).
//
// PERF (Phase 1) — client tracing is TREE-SHAKEN OUT of this bundle. See the
// `__SENTRY_TRACING__` DefinePlugin in next.config.ts for the mechanism and the
// measurements. `tracesSampleRate` is deliberately absent here: it only governs
// how much is SENT, not what is SHIPPED, so leaving it set would read as if
// client tracing were still on when the code implementing it no longer exists.
//
// Server-side tracing is UNAFFECTED and still runs at 10% — see
// sentry.server.config.ts. It is the only server timing signal the app has, so
// the tree-shake is scoped to the browser build only. Error capture, which is
// what this file exists for, is untouched in both.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  debug: false,
});

// Next calls this on every client route transition. `captureRouterTransitionStart`
// is exported from the SDK unconditionally (it is NOT behind the tracing flag),
// so this stays a valid export; with tracing shaken out it simply records no
// span. Keep it: re-enabling tracing must not also require re-wiring this hook.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
