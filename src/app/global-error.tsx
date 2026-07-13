"use client";

// Root error boundary for the App Router. This catches errors thrown in the
// root layout / templates that other error.tsx boundaries can't reach, and
// reports them to Sentry. It must render its own <html>/<body>.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0A0B10",
          color: "#E5E7EB",
        }}
      >
        <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: "0.875rem", opacity: 0.7, maxWidth: "24rem" }}>
          An unexpected error occurred. Please reload the page — if it keeps
          happening, try again in a little while.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem 1.25rem",
            borderRadius: "0.5rem",
            border: "1px solid rgba(255,255,255,0.15)",
            background: "transparent",
            color: "inherit",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
