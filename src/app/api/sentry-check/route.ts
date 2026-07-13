// Deliberate error trigger to verify Sentry captures server errors end-to-end.
// Acceptance test for launch Blocker 0.6 / LR-05: hit this on a PREVIEW deploy
// and confirm the error appears in Sentry with a readable stack.
//
// Hard-gated OFF in production so it can't be used to spam the error queue.
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export function GET() {
  if (process.env.VERCEL_ENV === "production") notFound();
  throw new Error("Sentry check: deliberate test error from /api/sentry-check");
}
