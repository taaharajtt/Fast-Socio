// Sentry initialization for the Edge runtime (proxy.ts / any edge route).
// Imported from `src/instrumentation.ts`. Same privacy posture as the server
// config — see `sentry.server.config.ts` for the rationale.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  debug: false,
});
