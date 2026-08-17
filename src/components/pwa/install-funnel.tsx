"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useInstallState } from "@/lib/pwa/use-install-state";
import { isStandalone } from "@/lib/pwa/install";
import { isHandoffDismissed } from "@/lib/pwa/snooze";
import { recordInstallEvent } from "@/lib/pwa/telemetry";
import { InstallPrompt } from "./install-prompt";
import { OpenInBrowser } from "./open-in-browser";

/**
 * The single decision point for install UI, mounted once at the ROOT layout.
 *
 * This is the audit's P0-2. The install prompt used to be mounted in exactly
 * one place — `(student)/layout.tsx` — which meant the entire install funnel
 * did not exist until a user had verified their email, set a password and
 * finished the onboarding wizard. Every screen where a new arrival actually
 * decides whether to stay (`/login`, `/signup`, `/onboarding`) had no install
 * code in it at all, which is why an Instagram arrival essentially never saw
 * one. Mounting at the root fixes reach; this component decides relevance.
 *
 * Order matters. An in-app webview cannot install on either platform, so the
 * handoff always wins over the install ask — offering someone an Install button
 * their browser will ignore is the false affordance the audit ruled out.
 *
 * Renders nothing on the server and nothing during hydration: everything it
 * keys off (standalone, webview, snooze) is client-only, so the first pass is
 * always null and there is no mismatch to create.
 */

const noopSubscribe = () => () => {};

/**
 * Routes that never show install UI:
 *
 *  /auth/*       mid-flight magic-link handling; it redirects within moments
 *                and covering it with an overlay would look like a failure
 *  /admin        a console, not the student product
 *  /banned       do not invite someone to install what they've lost access to
 *  /maintenance  the app is down; an install ask reads as tone-deaf
 *  /styleguide   internal
 *  the (public) informational pages — /privacy, /terms, /about, /support are
 *                linked from outside and read by people who are not signing up
 *
 * /set-password and /forgot-password are silent for a different reason: they
 * are single-field, single-purpose screens in the middle of signup, and the
 * onboarding wizard makes the real ask a minute later. Two asks that close
 * together is how an invitation turns into nagging.
 */
const SILENT_PREFIXES = ["/auth/", "/admin", "/banned", "/maintenance", "/styleguide"];
const SILENT_EXACT = [
  "/privacy",
  "/terms",
  "/about",
  "/support",
  "/set-password",
  "/forgot-password",
];

function isSilent(pathname: string): boolean {
  return (
    SILENT_EXACT.includes(pathname) ||
    SILENT_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

/**
 * Screens with no floating dock, so the banner sits lower. By the time this is
 * consulted the silent routes and /onboarding are already handled, so the only
 * dockless screens left are the two signed-out entry points.
 */
function hasDock(pathname: string): boolean {
  return !(pathname === "/login" || pathname === "/signup");
}

export function InstallFunnel() {
  const pathname = usePathname();
  // The same state machine the banner, the onboarding step and the Settings
  // row read, so all four agree about what this browser can do.
  const state = useInstallState();
  // Whether the handoff has been waved away for this tab is the funnel's own
  // concern, not the platform's, so it stays separate from that state.
  const handoffDismissed = useSyncExternalStore(
    noopSubscribe,
    isHandoffDismissed,
    () => false
  );

  // The two counters that belong to the funnel rather than to any one surface:
  // the outcome we are chasing (someone opened the app from their home screen)
  // and the capability that makes the whole Chromium path possible. Recorded
  // here because this component is mounted on every route, so neither depends
  // on the user reaching a particular screen. Once per tab — see telemetry.ts.
  useEffect(() => {
    if (state.kind === "native") {
      recordInstallEvent("event_available", "launch");
    }
    if (state.kind !== "installed") return;
    // "installed" covers two different things and they must not be conflated:
    // running FROM the home screen (the outcome we are chasing) and
    // `appinstalled` firing in a browser tab that is still a browser tab.
    // isStandalone() is what tells them apart.
    if (isStandalone()) {
      recordInstallEvent("standalone_launch", "launch");
    } else {
      // An install we cannot attribute to a surface — it also catches installs
      // done through the browser's own menu, which is exactly why it is
      // recorded here and bucketed as 'launch' rather than guessed at.
      recordInstallEvent("app_installed", "launch");
    }
  }, [state.kind]);

  // Already installed — every ask below is noise. This is also the check that
  // keeps the funnel silent for the users who already did what we wanted.
  if (state.kind === "installed") return null;
  if (isSilent(pathname)) return null;

  // No install is possible from inside a social app's webview on any platform.
  // Get them out first; the install ask meets them on the other side.
  if (state.kind === "webview") {
    return handoffDismissed ? null : <OpenInBrowser />;
  }

  // The onboarding wizard makes the primary ask itself, as its last step —
  // peak commitment, nothing else competing for attention. A floating banner
  // on top of that would be a second, weaker version of the same request.
  if (pathname.startsWith("/onboarding")) return null;

  return <InstallPrompt placement={hasDock(pathname) ? "dock" : "plain"} />;
}
