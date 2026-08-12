"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { isStandalone } from "@/lib/pwa/install";

/**
 * A one-time hello for people arriving from the previous address.
 *
 * Deliberately narrow in scope. Someone who followed a link from the old origin
 * has a specific worry — "did I end up somewhere I shouldn't be?" — and one
 * sentence resolves it. Everyone else should never see this, so the trigger is
 * evidence of arrival rather than a banner shown to all traffic:
 *
 *   1. `?from=old` on the URL (set by the old origin's CTA), or
 *   2. a referrer whose origin is the old deployment.
 *
 * Neither is required for correctness — miss both and the visitor simply gets
 * the normal app, which is the right failure mode.
 *
 * Shown ONCE ever, then a flag in localStorage retires it permanently: a
 * migration notice that keeps reappearing stops being reassurance and starts
 * being noise.
 *
 * The install invitation here is a single line of text, not a second install
 * button — `InstallPrompt` already owns that flow (beforeinstallprompt, iOS
 * share-sheet steps, snoozing), and two competing install UIs would be worse
 * than one good one.
 */
const OLD_ORIGIN = "https://fast-socio.vercel.app";
const SEEN_KEY = "migration-welcomed";

export function MigrationWelcome() {
  const [show, setShow] = useState(false);
  const [installable, setInstallable] = useState(false);

  useEffect(() => {
    // Everything here is client-only and runs after paint, so the server and
    // first client render agree (both render nothing) — no hydration mismatch.
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // Private mode / storage disabled: treat as unseen. Showing a welcome
      // once per visit is a far smaller cost than crashing on read.
    }
    if (seen) return;

    const params = new URLSearchParams(window.location.search);
    const flagged = params.get("from") === "old";

    let referred = false;
    try {
      referred =
        Boolean(document.referrer) &&
        new URL(document.referrer).origin === OLD_ORIGIN;
    } catch {
      /* malformed referrer — ignore */
    }

    if (!flagged && !referred) return;

    // Drop the marker from the address bar so it is not shared, bookmarked, or
    // carried into analytics. Nothing about it is worth persisting.
    if (flagged) {
      params.delete("from");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
      );
    }

    setInstallable(!isStandalone());
    setShow(true);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* nothing to do — it just shows again next visit */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
      role="status"
      aria-live="polite"
    >
      <GlassCard
        strong
        radius="lg"
        className="pointer-events-auto mx-auto flex max-w-md items-start gap-3 p-3"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Welcome to the new Fast Socio 🚀</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            You&rsquo;re on our new home.
            {installable
              ? " Add Fast Socio to your home screen for quick access."
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1 text-fg-muted transition-colors hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </GlassCard>
    </div>
  );
}
