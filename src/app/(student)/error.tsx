"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { RotateCw, ChevronLeft } from "lucide-react";
import Link from "next/link";

/**
 * Recoverable error boundary for every signed-in student route.
 *
 * WHY THIS EXISTS. Until now the app had exactly one error boundary,
 * `app/global-error.tsx`, which only catches failures in the root layout. Any
 * error thrown while rendering a student route therefore fell all the way
 * through to it — and `global-error` renders its own `<html>`/`<body>`, so the
 * entire document was replaced. The dock vanished, the route was gone, and the
 * only way back was a manual reload. A failed navigation to one tab should not
 * cost you the app.
 *
 * This boundary sits inside the student shell instead, so the dock and the
 * layout survive, and `reset()` retries just the segment that failed. That is
 * the difference between "Communities didn't load, tap retry" and "the app
 * broke, start again".
 *
 * It is deliberately STATIC: no data fetching, no auth check, no database
 * work. An error boundary that can itself throw is worse than none, and this
 * one renders while something is already known to be wrong.
 *
 * Errors still reach Sentry. `digest` is the server-side error id Next
 * generates for a server-render failure; it is the only handle support has for
 * correlating "it broke for me" with a stack trace, so it is shown.
 */
export default function StudentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-lg font-bold text-fg">This didn&apos;t load</h1>
      <p className="mt-2 max-w-[32ch] text-sm text-fg-muted">
        Something went wrong on our side. Your account and your messages are
        fine — this screen just failed to open.
      </p>

      <div className="mt-6 flex w-full flex-col gap-2">
        <button
          type="button"
          onClick={reset}
          className="pressable focus-ring flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent text-white transition-colors hover:bg-accent-light"
        >
          <RotateCw className="h-4 w-4" aria-hidden />
          Try again
        </button>
        <Link
          href="/home"
          className="pressable focus-ring flex h-11 w-full items-center justify-center gap-2 rounded-full text-fg-muted hover:text-fg"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Back to Home
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 font-mono text-[11px] text-fg-muted">
          Reference: {error.digest}
        </p>
      )}
    </main>
  );
}
