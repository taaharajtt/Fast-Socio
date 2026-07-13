// Next.js server instrumentation hook. Runs once per server instance before it
// handles requests. We use it to (1) initialize Sentry for whichever runtime is
// booting and (2) forward captured server errors to Sentry via onRequestError.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Routes errors thrown during rendering / route handlers / server actions to
// Sentry. Provided by the SDK so digests and request context are attached.
export const onRequestError = Sentry.captureRequestError;
