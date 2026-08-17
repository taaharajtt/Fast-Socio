"use client";

import { createClient } from "@/lib/supabase/client";
import { isAndroid, isIOS } from "./install";

/**
 * Install-funnel counters (audit P3-1).
 *
 * Everything above this line in the funnel work was reasoned from evidence
 * gathered by hand — reading the code, probing production, stubbing user
 * agents. That was enough to find the bugs. It is not enough to tell whether
 * the fixes moved the number that matters, which is how many students end up
 * with a home-screen icon. These counters exist so the next decision about the
 * funnel is made from data instead of from another argument.
 *
 * WHAT IS SENT: three short enum labels and nothing else. No user id, no email,
 * no session, no user-agent string, no URL, no free text. The server function
 * (migration 0150) records only a day, the three labels and a count, and has no
 * access to an identity even if someone later tries to attach one. Platform is
 * deliberately coarse — 'android' / 'ios' / 'desktop' — because "does iOS still
 * fail?" is a question worth answering and "which phone is this?" is not.
 *
 * FAILURE IS ALWAYS SILENT. This is telemetry attached to the login screen of a
 * social app; a blocked request, an offline phone, an ad-blocker or a schema
 * that has moved on must never produce a visible error, and must never delay
 * anything. Every call is fire-and-forget and every path swallows.
 */

export type InstallEvent =
  | "standalone_launch"
  | "event_available"
  | "cta_shown"
  | "cta_tapped"
  | "outcome_accepted"
  | "outcome_dismissed"
  | "app_installed"
  | "ask_snoozed";

export type InstallSurface =
  | "banner"
  | "onboarding"
  | "settings"
  | "handoff"
  | "launch";

function platform(): "android" | "ios" | "desktop" | "other" | "unknown" {
  if (typeof window === "undefined") return "unknown";
  try {
    if (isIOS()) return "ios";
    if (isAndroid()) return "android";
    // Coarse desktop test: no touch and a wide viewport. Wrong occasionally on
    // touchscreen laptops, which costs nothing — this is a bucket label, not a
    // capability check, and no behaviour anywhere branches on it.
    if (navigator.maxTouchPoints === 0) return "desktop";
    return "other";
  } catch {
    return "unknown";
  }
}

/**
 * Fire each (event, surface) pair at most once per tab.
 *
 * Without this, `cta_shown` would count re-renders rather than impressions —
 * the banner re-renders on every client-side navigation, so a user who browsed
 * ten screens would look like ten people who saw the ask. Per-tab is the right
 * grain: it matches "one visit, one impression", and it keeps the counters
 * comparable between a user who reloads and one who does not.
 *
 * Held in memory rather than sessionStorage on purpose — it is a de-duplication
 * hint, not a preference, and storage in this app is already carrying enough
 * that actually matters.
 */
const fired = new Set<string>();

export function recordInstallEvent(
  event: InstallEvent,
  surface: InstallSurface,
  options?: { once?: boolean }
): void {
  if (typeof window === "undefined") return;
  const key = `${event}:${surface}`;
  // Impressions and launches are once-per-tab; taps and outcomes are real
  // actions and every one of them counts.
  const once = options?.once ?? true;
  if (once) {
    if (fired.has(key)) return;
    fired.add(key);
  }

  try {
    // No await, no error surface, no retry. If it lands, it lands.
    void createClient()
      .rpc("record_pwa_install_event", {
        p_event: event,
        p_platform: platform(),
        p_surface: surface,
      })
      .then(
        () => undefined,
        () => undefined
      );
  } catch {
    /* client not constructible (no env, private mode) — drop the count */
  }
}
