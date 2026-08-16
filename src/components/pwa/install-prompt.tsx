"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { GlassButton, GlassCard, GlassSheet } from "@/components/ui";
import { promptInstall } from "@/lib/pwa/install-store";
import { recordInstallEvent } from "@/lib/pwa/telemetry";
import { useInstallState } from "@/lib/pwa/use-install-state";
import { isInstallSnoozed, snoozeInstall } from "@/lib/pwa/snooze";
import {
  IOSInstallSteps,
  IOSReloginNote,
  MenuInstallSteps,
} from "./install-instructions";

/**
 * Invites browser-tab users to put FAST SOCIO on their home screen.
 *
 * The event is not listened for here. It is banked before hydration by the
 * inline script in the root layout (see `src/lib/pwa/install-store.ts` for why
 * a `useEffect` loses it) and resolved into a state by `useInstallState`.
 *
 * WHICH STATES THIS SURFACE IS ALLOWED TO SHOW — this is a banner the user did
 * not ask for, so it only appears when there is something certain to say:
 *
 *   native   a real Install button, backed by a real event
 *   ios      share-sheet steps, worded for the specific iOS browser
 *   menu     a browser positively known to have no install event but a working
 *            menu item (Firefox Android, desktop Safari) — the silent dead end
 *            the audit found, now filled
 *
 * It deliberately says NOTHING for `waiting`. That state covers Chromium
 * before its event arrives AND Chromium where the app is already installed, and
 * an uninvited "open your browser menu" would be wrong advice in both. It also
 * says nothing for `webview` (InstallFunnel routes those to the handoff) or
 * `installed`. Settings is where an uncertain state still gets an answer,
 * because there the user asked the question.
 *
 * Dismissal is snoozed (not permanent) so we re-ask later without nagging, and
 * an install — ours or the browser's own — silences it for good.
 */
export function InstallPrompt({
  placement = "dock",
}: {
  /**
   * Where the card sits. "dock" clears the floating dock on student screens;
   * "plain" is for the routes that have no dock (login, signup), which only
   * became reachable once the funnel moved above the (student) route group.
   */
  placement?: "dock" | "plain";
}) {
  const state = useInstallState();
  const [dismissed, setDismissed] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);

  // There is deliberately no "write a snooze when appinstalled fires" effect
  // here. It would never run — InstallFunnel stops rendering this component the
  // moment the state becomes "installed" — and it would be redundant anyway:
  // Chromium does not re-fire `beforeinstallprompt` once the app is installed,
  // so the state falls to `waiting` on the next load and this surface is
  // already silent. (iOS fires no `appinstalled` at all, so nothing could have
  // depended on it there either.)

  const snooze = useCallback(() => {
    recordInstallEvent("ask_snoozed", "banner", { once: false });
    snoozeInstall();
    setDismissed(true);
    setStepsOpen(false);
  }, []);

  const install = useCallback(async () => {
    recordInstallEvent("cta_tapped", "banner", { once: false });
    const outcome = await promptInstall();
    if (outcome !== "unavailable") {
      recordInstallEvent(
        outcome === "accepted" ? "outcome_accepted" : "outcome_dismissed",
        "banner",
        { once: false }
      );
    }
    // Chrome re-fires the event on a later visit if the user declined, so a
    // dismissal only needs to quiet us for the snooze window.
    if (outcome === "dismissed") snoozeInstall();
    if (outcome === "unavailable") setDismissed(true);
  }, []);

  const showSteps = useCallback(() => {
    recordInstallEvent("cta_tapped", "banner", { once: false });
    setStepsOpen(true);
  }, []);

  const speakable =
    state.kind === "native" || state.kind === "ios" || state.kind === "menu";
  const visible = speakable && !dismissed && !isSnoozed();

  // Impressions. Once per tab (see telemetry.ts): the banner re-renders on
  // every client-side navigation, so counting renders would turn one visit into
  // one count per screen browsed. The effect sits above the early return
  // because hooks must run unconditionally; `visible` is what gates the count.
  useEffect(() => {
    if (visible) recordInstallEvent("cta_shown", "banner");
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      {/* On student screens this sits above the floating dock (fixed, bottom-0,
          ~5rem tall) and below the modal layer (z-50) so sheets cover it. On
          dockless screens it sits just above the safe area instead. */}
      <div
        className="pointer-events-none fixed inset-x-0 z-40 px-4"
        style={{
          bottom:
            placement === "dock"
              ? "calc(var(--dock-total) + 1rem)"
              : "max(1rem, calc(env(safe-area-inset-bottom, 0px) + 1rem))",
        }}
      >
        <GlassCard
          strong
          radius="lg"
          className="pointer-events-auto mx-auto flex max-w-md items-center gap-3 p-3"
        >
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-[12px]"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Keep Socio one tap away</p>
            <p className="text-xs text-fg-muted">
              {state.kind === "native"
                ? "Get the full-screen app and notifications."
                : "Add to your Home Screen for notifications and a full-screen app."}
            </p>
          </div>
          {/* The label tells the truth about what the tap does: "Install" only
              where a tap really opens the browser's install dialog. */}
          <GlassButton
            size="sm"
            onClick={state.kind === "native" ? install : showSteps}
          >
            {state.kind === "native" ? "Install" : "How"}
          </GlassButton>
          <GlassButton
            size="sm"
            variant="ghost"
            aria-label="Not now"
            onClick={snooze}
            className="px-2"
          >
            ✕
          </GlassButton>
        </GlassCard>
      </div>

      {/* No install API on these platforms — the only route is the browser's own
          menu, so spell it out rather than pretending we can trigger it. */}
      <GlassSheet
        open={stepsOpen}
        onClose={() => setStepsOpen(false)}
        label="Add FAST SOCIO to your Home Screen"
      >
        <h2 className="text-lg font-bold">Add to Home Screen</h2>
        {state.kind === "ios" && (
          <>
            <p className="mt-1 text-sm text-fg-muted">
              iPhone and iPad can only install from the share menu — it takes two
              taps.
            </p>
            <div className="mt-5">
              <IOSInstallSteps browser={state.browser} />
            </div>
            <div className="mt-5 border-t border-glass-border pt-4">
              <IOSReloginNote />
            </div>
          </>
        )}
        {state.kind === "menu" && (
          <div className="mt-4">
            <MenuInstallSteps browser={state.browser} />
          </div>
        )}
        {/* "Got it" snoozes as well as closing. Neither iOS nor a menu-based
            install tells us it happened — there is no `appinstalled` on iOS at
            all — so someone who reads the steps and follows them would
            otherwise be asked again on every single load. Treating "I've read
            them" as "stop asking for a while" is the closest thing to an
            install signal these platforms give us. */}
        <GlassButton className="mt-6 w-full" variant="glass" onClick={snooze}>
          Got it
        </GlassButton>
      </GlassSheet>
    </>
  );
}

/**
 * Reading the snooze during render is safe here and nowhere near the hydration
 * path: every state that can reach this line is client-only, so the server and
 * the first client pass both render null regardless of what storage says.
 */
function isSnoozed(): boolean {
  if (typeof window === "undefined") return false;
  return isInstallSnoozed();
}
