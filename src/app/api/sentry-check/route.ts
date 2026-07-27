// Deliberate error trigger to verify Sentry captures server errors end-to-end.
// Acceptance test for launch Blocker 0.6 / LR-05: hit this on a PREVIEW deploy
// and confirm the error appears in Sentry with a readable stack.
//
// Hard-gated OFF in production so it can't be used to spam the error queue.
import { notFound } from "next/navigation";
import { connection } from "next/server";

// This handler exists to throw, so it must never run during the build. It used
// to say `dynamic = "force-dynamic"`, which Cache Components rejects; awaiting
// connection() is the replacement — it holds rendering until a real request
// arrives, so the prerender pass walks straight past it.
export async function GET() {
  await connection();
  if (process.env.VERCEL_ENV === "production") notFound();
  throw new Error("Sentry check: deliberate test error from /api/sentry-check");
}
