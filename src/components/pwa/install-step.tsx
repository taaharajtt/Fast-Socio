"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Bell, Maximize, Zap } from "lucide-react";
import { GlassButton, GlassCard } from "@/components/ui";
import { promptInstall } from "@/lib/pwa/install-store";
import { recordInstallEvent } from "@/lib/pwa/telemetry";
import { useInstallState } from "@/lib/pwa/use-install-state";
import {
  GenericInstallSteps,
  IOSInstallSteps,
  IOSReloginNote,
  MenuInstallSteps,
  WebviewInstallNote,
} from "./install-instructions";

/**
 * The primary install ask, as the last step of onboarding.
 *
 * WHY HERE. This is the strongest moment in the whole journey to ask, and the
 * reasoning is worth keeping next to the code: the user has just spent several
 * minutes on email, password, photo and profile, so commitment is at its peak;
 * they have not yet been handed a feed to be distracted by; and the ask
 * pre-empts a return trip rather than interrupting one. The old placement — a
 * floating banner at the bottom of a brand-new /home feed — competed with the
 * first content the user ever saw, and only worked at all if
 * `beforeinstallprompt` happened to win a race against hydration.
 *
 * It is a STEP, not a gate. "Finish" always works; nothing here can trap a user
 * outside the app they just signed up for.
 *
 * Unlike the floating banner, this screen answers EVERY state including
 * `waiting` — a dedicated step cannot simply render nothing, and here the user
 * is looking straight at it, so generic-but-true directions beat a blank. What
 * it still never does is label a button "Install" where tapping it would do
 * nothing: the real button appears only in the `native` state.
 */
export function InstallStep() {
  const state = useInstallState();
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);

  // Impressions for the strongest ask in the funnel. Unlike the banner this
  // screen always renders something, so the count is "reached the install step"
  // — the denominator the accept rate below is measured against.
  useEffect(() => {
    recordInstallEvent("cta_shown", "onboarding");
  }, []);

  // No effect resets `busy` when the install succeeds: accepting the native
  // dialog flips the state to "installed" via `appinstalled`, which stops
  // rendering the button entirely. The state derives itself.
  const install = useCallback(async () => {
    recordInstallEvent("cta_tapped", "onboarding", { once: false });
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome !== "unavailable") {
      recordInstallEvent(
        outcome === "accepted" ? "outcome_accepted" : "outcome_dismissed",
        "onboarding",
        { once: false }
      );
    }
    if (outcome !== "accepted") setDeclined(true);
  }, []);

  const installed = state.kind === "installed";

  return (
    <section className="space-y-5">
      <div className="flex flex-col items-center text-center">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 rounded-[18px]"
        />
        <h1 className="mt-4 text-2xl font-bold">
          {installed ? "You’re all set" : "Keep Socio one tap away"}
        </h1>
        <p className="mt-1 max-w-[20rem] text-fg-muted">
          {installed
            ? "Fast Socio is on your Home Screen. Tap Finish to jump in."
            : "Add Fast Socio to your Home Screen so it opens like an app — not a browser tab you’ll forget."}
        </p>
      </div>

      {!installed && (
        <GlassCard className="space-y-3 p-4">
          <Benefit icon={<Maximize className="h-4 w-4" aria-hidden />}>
            Full screen, no address bar
          </Benefit>
          <Benefit icon={<Bell className="h-4 w-4" aria-hidden />}>
            Notifications when someone messages you
          </Benefit>
          <Benefit icon={<Zap className="h-4 w-4" aria-hidden />}>
            Opens straight from your Home Screen
          </Benefit>
        </GlassCard>
      )}

      {state.kind === "native" && (
        <>
          <GlassButton
            size="lg"
            className="h-[52px] w-full text-base font-bold"
            onClick={install}
            disabled={busy}
          >
            {busy ? "Opening…" : "Install Fast Socio"}
          </GlassButton>
          {declined && (
            <p className="text-center text-xs text-fg-muted">
              No problem — you can install any time from Settings.
            </p>
          )}
        </>
      )}

      {state.kind === "ios" && (
        <GlassCard className="p-4">
          <p className="text-sm font-semibold">Two taps on iPhone:</p>
          <div className="mt-4">
            <IOSInstallSteps browser={state.browser} />
          </div>
          <div className="mt-4 border-t border-glass-border pt-3">
            <IOSReloginNote />
          </div>
        </GlassCard>
      )}

      {state.kind === "menu" && (
        <GlassCard className="p-4">
          <MenuInstallSteps browser={state.browser} />
        </GlassCard>
      )}

      {state.kind === "waiting" && (
        <GlassCard className="p-4">
          <GenericInstallSteps />
          <p className="mt-2 text-xs text-fg-muted">
            Already added it? Then you&rsquo;re done — tap Finish.
          </p>
        </GlassCard>
      )}

      {state.kind === "webview" && (
        <GlassCard className="p-4">
          <WebviewInstallNote />
        </GlassCard>
      )}
    </section>
  );
}

function Benefit({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-3 text-sm">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        {icon}
      </span>
      {children}
    </p>
  );
}
